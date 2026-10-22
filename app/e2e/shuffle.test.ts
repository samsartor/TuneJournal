import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { RELAY, addTune, backToList, card, editFromCard, open } from './helpers';
import { mockMedia, wav } from './media';

test.beforeEach(async ({ page }) => {
	await page.routeWebSocket(RELAY, (ws) => ws.close());
	await mockMedia(page);
	await open(page);
});

const shufflePlayer = (page: Page) => page.getByTestId('shuffle-player');
const shuffleCard = (page: Page) => page.getByTestId('shuffle-card');
const cardTitle = (page: Page) => shuffleCard(page).getByRole('heading', { level: 2 });
const detail = (page: Page) => page.getByRole('region', { name: 'Details' });
const settingsDialog = (page: Page) => page.getByRole('dialog', { name: 'Shuffle settings' });
const time = async (page: Page) => Number(await shufflePlayer(page).getAttribute('data-time'));

/** Optional screenshots for review: SHOTS=<dir> npm run test:e2e -- shuffle */
async function shot(page: Page, info: TestInfo, name: string) {
	const dir = process.env.SHOTS;
	if (dir) await page.screenshot({ path: `${dir}/${info.project.name}-${name}.png` });
}

async function openShuffle(page: Page) {
	// One link is the desktop toolbar's, the other the phone's floating button; one is hidden.
	await page.getByRole('link', { name: 'Shuffle', exact: true }).click();
	await expect(page.getByRole('heading', { level: 1, name: 'Shuffle' })).toBeVisible();
}

async function closeShuffle(page: Page) {
	await page.getByRole('link', { name: 'Close shuffle' }).click();
	await expect(page.getByRole('searchbox', { name: 'Search' })).toBeVisible();
}

async function openPiece(page: Page, title: string) {
	await card(page, title).getByRole('link', { name: title }).click();
	await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
}

async function upload(page: Page, name: string, seconds = 6) {
	const more = page.getByRole('button', { name: '+ Add recording' });
	if (await more.isVisible()) await more.click();
	await page
		.getByLabel('Upload a file')
		.setInputFiles({ name, mimeType: 'audio/wav', buffer: wav(seconds) });
	await expect(page.getByRole('listitem', { name: name.replace(/\.wav$/, '') })).toBeVisible();
}

test('Practiced logs and advances, Skip logs nothing, then everything’s been shown', async ({
	page
}, info) => {
	await addTune(page, info, { title: 'The Kesh', key: 'G', firstNotes: 'GED DEF', tags: ['Jig'] });
	await addTune(page, info, { title: 'Cooley’s', tags: ['Reel'] });

	await openShuffle(page);
	// Full-screen: no list, no mini-player bar.
	await expect(page.getByRole('region', { name: 'Library' })).toBeHidden();
	await expect(page.getByTestId('player')).toHaveCount(0);
	await expect(shuffleCard(page)).toBeVisible();
	await expect(shuffleCard(page).getByTestId('last-practiced')).toHaveText('Never practiced');
	await expect(shufflePlayer(page)).toContainText('No recordings');
	await shot(page, info, 'shuffle-card');

	const first = (await cardTitle(page).textContent())!.trim();
	expect(['The Kesh', 'Cooley’s']).toContain(first);
	const second = first === 'The Kesh' ? 'Cooley’s' : 'The Kesh';
	if (first === 'The Kesh') {
		await expect(shuffleCard(page).getByTestId('shuffle-key')).toHaveText('G maj');
		await expect(shuffleCard(page).getByLabel('First notes')).toHaveText('GED DEF');
		await expect(shuffleCard(page).getByRole('list', { name: 'Tags' })).toHaveText('Jig');
	}

	// Practiced, with a skill change on the way: logged with the new skill.
	await page.getByRole('slider', { name: 'Skill' }).fill('3');
	await page.getByRole('button', { name: 'Practiced' }).click();
	await expect(cardTitle(page)).toHaveText(second);

	// Skip, after moving the slider: the skill is saved, nothing is logged.
	await page.getByRole('slider', { name: 'Skill' }).fill('4');
	await page.getByRole('button', { name: 'Skip' }).click();

	await expect(
		page.getByRole('heading', { name: 'You’ve been through everything 🎉' })
	).toBeVisible();
	await expect(page.getByText('2 pieces this round.')).toBeVisible();
	await shot(page, info, 'shuffle-done');

	// Restart deals again from everything.
	await page.getByRole('button', { name: 'Restart' }).click();
	await expect(shuffleCard(page)).toBeVisible();

	await closeShuffle(page);
	await expect(card(page, first).getByTestId('last-practiced')).toHaveText(
		'Last practiced just now'
	);
	await expect(card(page, second).getByTestId('last-practiced')).toHaveText('Never practiced');

	await openPiece(page, first);
	await expect(page.getByRole('slider', { name: 'Skill' })).toHaveValue('3');
	await expect(detail(page).getByTestId('last-practiced')).toContainText('1 time');
	await backToList(page, info);
	await openPiece(page, second);
	await expect(page.getByRole('slider', { name: 'Skill' })).toHaveValue('4');
	await expect(detail(page).getByTestId('last-practiced')).toHaveText('Never practiced');
	await expect(page.getByText('Not practiced yet.')).toBeVisible();
});

test('plays a recording, with speed and loop kept from card to card', async ({ page }, info) => {
	await addTune(page, info, { title: 'The Kesh', key: 'G' });
	await openPiece(page, 'The Kesh');
	await upload(page, 'kesh-take.wav');
	await upload(page, 'kesh-in-a.wav', 4);
	// The second take is in another key.
	await page
		.getByRole('listitem', { name: 'kesh-in-a' })
		.getByRole('button', { name: /^Actions for/ })
		.click();
	await page.getByRole('menuitem', { name: 'Details…' }).click();
	const details = page.getByRole('dialog');
	await details.getByLabel('Key as text').fill('A');
	await details.getByRole('button', { name: 'Done' }).click();
	await expect(details).toBeHidden();
	await backToList(page, info);

	await addTune(page, info, { title: 'Cooley’s' });
	await openPiece(page, 'Cooley’s');
	await upload(page, 'cooleys.wav');
	await backToList(page, info);

	await openShuffle(page);
	const bar = shufflePlayer(page);
	// The first recording is chosen.
	const kesh = (await cardTitle(page).textContent())!.trim() === 'The Kesh';
	const picker = bar.getByLabel('Recording');
	if (kesh) {
		await expect(picker).toHaveValue(/.+/);
		await expect(picker.locator('option:checked')).toHaveText('kesh-take');
		await expect(picker.locator('option').nth(1)).toHaveText('kesh-in-a · in A maj');
		await picker.selectOption({ label: 'kesh-in-a · in A maj' });
		await expect(bar.getByTestId('clip-key')).toHaveText('This recording is in A maj');
	} else {
		await expect(bar.getByTestId('shuffle-recording')).toContainText('cooleys');
	}

	await bar.getByRole('button', { name: 'Play' }).click();
	await expect(bar).toHaveAttribute('data-playing', 'true');
	await expect.poll(() => time(page)).toBeGreaterThan(0.5);

	const speed = bar.getByRole('group', { name: 'Speed' });
	await speed.getByRole('button', { name: '75% speed' }).click();
	await expect(bar).toHaveAttribute('data-rate', '0.75');
	await speed.getByRole('button', { name: 'Slower, 5%' }).click();
	await expect(bar).toHaveAttribute('data-rate', '0.7');
	await bar.getByRole('button', { name: 'Loop' }).click();
	await expect(bar.getByRole('button', { name: 'Loop' })).toHaveAttribute('aria-pressed', 'true');
	await bar.getByRole('slider', { name: 'Position' }).fill('3.8');
	// Looping: back to the start rather than stopping.
	await expect.poll(() => time(page), { timeout: 5000 }).toBeLessThan(2);
	await expect(bar).toHaveAttribute('data-playing', 'true');
	await bar.getByRole('button', { name: 'Pause' }).click();
	await expect(bar).toHaveAttribute('data-playing', 'false');
	await bar.getByRole('button', { name: 'Play' }).click();
	await expect(bar).toHaveAttribute('data-playing', 'true');
	await shot(page, info, 'shuffle-player');

	// Advancing stops playback; speed and loop stay as they were.
	await page.getByRole('button', { name: 'Skip' }).click();
	await expect(cardTitle(page)).toHaveText(kesh ? 'Cooley’s' : 'The Kesh');
	await expect(bar).toHaveAttribute('data-playing', 'false');
	await expect(bar).toHaveAttribute('data-rate', '0.7');
	await expect(bar.getByLabel('Current speed')).toHaveText('70%');
	await expect(bar.getByRole('button', { name: 'Loop' })).toHaveAttribute('aria-pressed', 'true');
	await bar.getByRole('button', { name: 'Play' }).click();
	await expect(bar).toHaveAttribute('data-playing', 'true');

	// Leaving stops it too, and the mini-player is back (empty) on the list.
	await closeShuffle(page);
	await expect(page.getByTestId('player')).toHaveCount(0);
});

test('settings: kinds (Parts too), skill range and temperatures persist; empty states', async ({
	page
}, info) => {
	await addTune(page, info, { title: 'The Kesh', skill: 3 });
	await addTune(page, info, { title: 'Kesh B part' });
	const dialog = await editFromCard(page, 'Kesh B part');
	await dialog.getByLabel('Kind').selectOption({ label: 'Part' });
	await dialog.getByRole('button', { name: 'Done' }).click();

	await openShuffle(page);
	await expect(cardTitle(page)).toHaveText('The Kesh');
	await page.getByRole('button', { name: 'Shuffle settings' }).click();
	const sheet = settingsDialog(page);
	const count = sheet.getByTestId('shuffle-count');
	await expect(count).toHaveText(/^1 piece matches/);

	// Parts can be included.
	await expect(sheet.getByRole('checkbox', { name: 'Tunes' })).toBeChecked();
	await sheet.getByRole('checkbox', { name: 'Parts' }).check();
	await expect(count).toHaveText(/^2 pieces match · 1 left this round/);

	// The skill range: unrated counts as 1.
	await sheet.getByRole('slider', { name: 'Minimum skill' }).fill('2');
	await expect(count).toHaveText(/^1 piece matches/);
	await sheet.getByRole('slider', { name: 'Maximum skill' }).fill('2');
	await expect(count).toHaveText(/^0 pieces match/);
	await sheet.getByRole('slider', { name: 'Maximum skill' }).fill('5');

	// Temperatures: all the way right is "Off" (∞).
	const age = sheet.getByRole('slider', { name: 'Age' });
	await age.fill('20');
	await expect(age).toHaveAttribute('aria-valuetext', 'Off, random');
	await sheet.getByRole('slider', { name: 'Favorite' }).fill('0');
	await sheet.getByRole('checkbox', { name: /Respect current list filter/ }).check();
	await shot(page, info, 'shuffle-settings');
	await sheet.getByRole('button', { name: 'Done' }).click();
	await expect(sheet).toBeHidden();

	await page.reload();
	await expect(shuffleCard(page)).toBeVisible();
	await page.getByRole('button', { name: 'Shuffle settings' }).click();
	await expect(sheet.getByRole('checkbox', { name: 'Parts' })).toBeChecked();
	await expect(sheet.getByRole('slider', { name: 'Minimum skill' })).toHaveValue('2');
	await expect(sheet.getByRole('slider', { name: 'Age' })).toHaveValue('20');
	await expect(sheet.getByRole('slider', { name: 'Favorite' })).toHaveValue('0');
	await expect(sheet.getByRole('checkbox', { name: /Respect current list filter/ })).toBeChecked();
	// The list shows Tunes only, and the shuffle now follows it.
	await expect(count).toHaveText(/^1 piece matches/);

	// Nothing left that matches: an empty state that leads back to the settings.
	await sheet.getByRole('slider', { name: 'Minimum skill' }).fill('4');
	await expect(count).toHaveText(/^0 pieces match/);
	await sheet.getByRole('button', { name: 'Done' }).click();
	await page.getByRole('button', { name: 'Skip' }).click();
	await expect(page.getByRole('heading', { name: 'Nothing to shuffle' })).toBeVisible();
	await page.getByRole('button', { name: 'Change settings' }).click();
	await sheet.getByRole('slider', { name: 'Minimum skill' }).fill('1');
	await sheet.getByRole('checkbox', { name: /Respect current list filter/ }).uncheck();
	await sheet.getByRole('button', { name: 'Done' }).click();
	// A card is dealt as soon as something matches.
	await expect(shuffleCard(page)).toBeVisible();
});
