import { expect, test, type Page } from '@playwright/test';
import { RELAY, addTune, backToList, card, isMobile, open } from './helpers';
import { SPOTIFY_URL, YT_ID, YT_URL, mockMedia, wav } from './media';

test.beforeEach(async ({ page }) => {
	await page.routeWebSocket(RELAY, (ws) => ws.close());
	await mockMedia(page);
	await open(page);
});

type YtStub = { __yt: { rates: number[]; loaded: string[] } };

const player = (page: Page) => page.getByTestId('player');
const clips = (page: Page) => page.getByTestId('clip');
const clip = (page: Page, name: string | RegExp) => page.getByRole('listitem', { name });
const time = async (page: Page) => Number(await player(page).getAttribute('data-time'));

async function openPiece(page: Page, title: string) {
	await card(page, title).getByRole('link', { name: title }).click();
	await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
}

async function upload(page: Page, name = 'kesh-take.wav', seconds = 6) {
	await page
		.getByLabel('Upload a file')
		.setInputFiles({ name, mimeType: 'audio/wav', buffer: wav(seconds) });
}

async function clipMenu(page: Page, name: string | RegExp, item: string) {
	await clip(page, name)
		.getByRole('button', { name: /^Actions for/ })
		.click();
	await page.getByRole('menuitem', { name: item }).click();
}

async function pasteLink(page: Page, url: string) {
	const input = page.getByLabel('YouTube, Spotify or other link');
	await input.fill(url);
	await page.getByRole('button', { name: 'Add link' }).click();
	// The field empties, or the whole panel folds away.
	await expect
		.poll(async () => (await input.count()) === 0 || (await input.inputValue()) === '')
		.toBe(true);
}

/** Shows the speed controls (folded behind a button on phones). */
async function speedControls(page: Page) {
	const toggle = player(page).getByRole('button', { name: /^Speed \d+%$/ });
	if (await toggle.isVisible()) await toggle.click();
	return player(page).getByRole('group', { name: 'Speed' });
}

test('uploads a recording and plays it, with speed and loop', async ({ page }, info) => {
	await addTune(page, info, { title: 'The Kesh' });
	await openPiece(page, 'The Kesh');

	// Nothing playable yet: the import panel is prominent.
	const panel = page.getByRole('group', { name: 'Add a recording' });
	await expect(panel.getByText('Add a recording to listen, loop and slow down.')).toBeVisible();
	await upload(page);

	await expect(clips(page)).toHaveCount(1);
	const row = clip(page, 'kesh-take');
	await expect(row).toContainText('Upload');
	await expect(row).toContainText('0:06');
	await expect(row).toContainText('Not backed up');
	// An upload is the only copy, so it's kept offline.
	await expect(row.getByRole('button', { name: 'Keep offline' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	// The panel folds into a small button once something plays.
	await expect(panel).toBeHidden();
	await expect(page.getByRole('button', { name: '+ Add recording' })).toBeVisible();

	await row.getByRole('button', { name: 'Play kesh-take' }).click();
	const bar = player(page);
	await expect(bar).toHaveAttribute('data-playing', 'true');
	await expect(bar.getByTestId('player-title')).toHaveText('kesh-take');
	await expect(bar.getByRole('link', { name: 'The Kesh' })).toBeVisible();
	await expect(bar).toHaveAttribute('data-start', '0.00');
	await expect(bar).toHaveAttribute('data-end', '6.00');
	await expect.poll(() => time(page)).toBeGreaterThan(0.5);
	await expect(row.getByRole('button', { name: 'Pause kesh-take' })).toBeVisible();

	// Speed: presets and ±5% steps.
	const speed = await speedControls(page);
	await speed.getByRole('button', { name: '75% speed' }).click();
	await expect(bar).toHaveAttribute('data-rate', '0.75');
	await expect(speed.getByRole('button', { name: '75% speed' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await speed.getByRole('button', { name: 'Slower, 5%' }).click();
	await expect(bar).toHaveAttribute('data-rate', '0.7');
	await expect(speed.getByLabel('Current speed')).toHaveText('70%');
	await speed.getByRole('button', { name: 'Faster, 5%' }).click();
	await speed.getByRole('button', { name: 'Faster, 5%' }).click();
	await expect(bar).toHaveAttribute('data-rate', '0.8');

	// Loop: near the end, it jumps back to the start and keeps playing.
	await bar.getByRole('button', { name: 'Loop' }).click();
	await expect(bar.getByRole('button', { name: 'Loop' })).toHaveAttribute('aria-pressed', 'true');
	await bar.getByRole('slider', { name: 'Position' }).fill('5.7');
	await expect.poll(() => time(page), { timeout: 5000 }).toBeLessThan(2);
	await expect(bar).toHaveAttribute('data-playing', 'true');

	// Without loop it stops at the end.
	await bar.getByRole('button', { name: 'Loop' }).click();
	await bar.getByRole('slider', { name: 'Position' }).fill('5.7');
	await expect(bar).toHaveAttribute('data-playing', 'false', { timeout: 5000 });
	expect(await time(page)).toBeGreaterThan(5.5);

	// The speed is remembered for next time.
	await page.reload();
	await expect(page.getByRole('heading', { level: 1, name: 'The Kesh' })).toBeVisible();
	await clip(page, 'kesh-take').getByRole('button', { name: 'Play kesh-take' }).click();
	await expect(player(page)).toHaveAttribute('data-rate', '0.8');

	// On phones the bar stays clear of the floating buttons on the list.
	await backToList(page, info);
	if (isMobile(info)) {
		const fab = await page.getByRole('button', { name: 'Add tune' }).boundingBox();
		const barBox = await player(page).boundingBox();
		expect(fab!.y + fab!.height).toBeLessThanOrEqual(barBox!.y);
	}
	await expect(player(page)).toBeVisible();
	// Cards show the providers of their recordings.
	await expect(
		card(page, 'The Kesh').getByRole('img', { name: 'Recordings: Upload' })
	).toBeVisible();
});

test('trims a recording and keeps the trim', async ({ page }, info) => {
	await addTune(page, info, { title: 'Trim Reel' });
	await openPiece(page, 'Trim Reel');
	await upload(page, 'trim-take.wav', 6);
	await expect(clips(page)).toHaveCount(1);

	await clipMenu(page, 'trim-take', 'Trim…');
	const dialog = page.getByRole('dialog', { name: /Trim/ });
	await expect(dialog.getByText('Drawing the waveform…')).toBeHidden();
	await expect(dialog.getByText('of 0:06')).toBeVisible();
	const start = dialog.getByLabel('Start', { exact: true });
	const end = dialog.getByLabel('End', { exact: true });
	await expect(end).toHaveValue('0:06.0');
	await start.fill('1');
	await start.press('Tab');
	await end.fill('0:03');
	await end.press('Tab');
	await expect(start).toHaveValue('0:01.0');
	await expect(end).toHaveValue('0:03.0');
	// An end before the start is refused.
	await end.fill('0:00.5');
	await end.press('Tab');
	await expect(end).toHaveValue('0:03.0');

	await dialog.getByRole('button', { name: 'Preview (loop)' }).click();
	await expect(dialog.getByRole('button', { name: 'Stop preview' })).toBeVisible();
	await dialog.getByRole('button', { name: 'Save trim' }).click();
	await expect(dialog).toBeHidden();
	await expect(clip(page, 'trim-take').getByTestId('clip-trim')).toHaveText('0:01–0:03');

	await page.reload();
	await expect(clip(page, 'trim-take').getByTestId('clip-trim')).toHaveText('0:01–0:03');

	// Playback stays within the trim.
	await clip(page, 'trim-take').getByRole('button', { name: 'Play trim-take' }).click();
	const bar = player(page);
	await expect(bar).toHaveAttribute('data-start', '1.00');
	await expect(bar).toHaveAttribute('data-end', '3.00');
	await expect.poll(() => time(page)).toBeGreaterThan(1.3);
	await expect(bar).toHaveAttribute('data-playing', 'false', { timeout: 5000 });
	const stopped = await time(page);
	expect(stopped).toBeGreaterThan(2.8);
	expect(stopped).toBeLessThan(3.2);

	// Reset brings back the whole file.
	await clipMenu(page, 'trim-take', 'Trim…');
	await expect(dialog.getByText('of 0:06')).toBeVisible();
	await dialog.getByRole('button', { name: 'Reset' }).click();
	await dialog.getByRole('button', { name: 'Save trim' }).click();
	await expect(clip(page, 'trim-take').getByTestId('clip-trim')).toBeHidden();
	await expect(bar).toHaveAttribute('data-end', '6.00');
});

test('pastes YouTube and Spotify links, plays YouTube in the stub player', async ({
	page
}, info) => {
	await addTune(page, info, { title: 'Link Jig', key: 'Edor' });
	await openPiece(page, 'Link Jig');

	const input = page.getByLabel('YouTube, Spotify or other link');
	await input.fill('not a link');
	await page.getByRole('button', { name: 'Add link' }).click();
	await expect(page.getByText('That doesn’t look like a link.')).toBeVisible();

	await input.fill(`https://youtu.be/${YT_ID}?t=30`);
	await expect(page.getByTestId('link-preview')).toContainText('The Kesh — live session');
	await expect(page.getByTestId('link-preview')).toContainText('from 30 s');
	await page.getByRole('button', { name: 'Add link' }).click();
	const yt = clip(page, 'The Kesh — live session');
	await expect(yt).toContainText('YouTube');
	await expect(yt.getByTestId('clip-trim')).toHaveText('0:30–end');

	// Once there's something playable, adding goes through "+ Add recording".
	await page.getByRole('button', { name: '+ Add recording' }).click();
	await pasteLink(page, SPOTIFY_URL);
	const sp = clip(page, 'Kesh Jig (album version)');
	await expect(sp).toContainText('Spotify ↗');
	await expect(
		sp.getByRole('link', { name: 'Open Kesh Jig (album version) on Spotify (new tab)' })
	).toHaveAttribute('href', SPOTIFY_URL);

	// Per-clip key override.
	await clipMenu(page, 'Kesh Jig (album version)', 'Edit…');
	const details = page.getByRole('dialog', { name: 'Edit recording' });
	await details.getByLabel('Key as text').fill('Ddor');
	await details.getByLabel('First notes (ABC)').fill('DEFG');
	await details.getByRole('button', { name: 'Done' }).click();
	await expect(sp).toContainText('D dor');
	await expect(sp).toContainText('DEFG');

	// YouTube plays through the (stubbed) IFrame API, from the clip start, with our speed.
	await yt.getByRole('button', { name: 'Play The Kesh — live session' }).click();
	const bar = player(page);
	await expect(bar).toHaveAttribute('data-kind', 'youtube');
	await expect(bar.getByTitle('YouTube video player (stub)')).toBeAttached();
	await expect(bar).toHaveAttribute('data-playing', 'true');
	await expect(bar).toHaveAttribute('data-start', '30.00');
	await expect(bar).toHaveAttribute('data-end', '240.00');
	await expect.poll(() => time(page)).toBeGreaterThan(30.3);
	const speed = await speedControls(page);
	await speed.getByRole('button', { name: '60% speed' }).click();
	await speed.getByRole('button', { name: 'Faster, 5%' }).click();
	await expect
		.poll(() => page.evaluate(() => (window as unknown as YtStub).__yt.rates.at(-1)))
		.toBe(0.65);
	expect(await page.evaluate(() => (window as unknown as YtStub).__yt.loaded)).toContain(YT_ID);

	// The YouTube trim editor is a timeline with flags and "set at playhead" buttons.
	await clipMenu(page, 'The Kesh — live session', 'Trim…');
	const dialog = page.getByRole('dialog', { name: /Trim/ });
	await expect(dialog.getByRole('slider', { name: 'End flag' })).toBeVisible();
	await dialog.getByRole('slider', { name: 'End flag' }).fill('45');
	await dialog.getByRole('button', { name: 'Preview (loop)' }).click();
	await expect(bar).toHaveAttribute('data-end', '45.00');
	await dialog.getByRole('button', { name: 'Set start at playhead' }).click();
	const startValue = Number(await dialog.getByRole('slider', { name: 'Start flag' }).inputValue());
	expect(startValue).toBeGreaterThan(29);
	await dialog.getByRole('button', { name: 'Save trim' }).click();
	await expect(dialog).toBeHidden();
	await expect(yt.getByTestId('clip-trim')).toHaveText(/^0:[23]\d–0:45$/);
});

test('reorders recordings, and removes one with undo', async ({ page }, info) => {
	await addTune(page, info, { title: 'Order Hornpipe' });
	await openPiece(page, 'Order Hornpipe');
	await upload(page, 'first.wav', 2);
	await expect(clips(page)).toHaveCount(1);
	await page.getByRole('button', { name: '+ Add recording' }).click();
	await pasteLink(page, 'https://example.com/second-page');
	await page.getByRole('button', { name: '+ Add recording' }).click();
	await pasteLink(page, SPOTIFY_URL);
	const titles = () => clips(page).locator('.title').allTextContents();
	await expect.poll(titles).toEqual(['first', 'Link recording', 'Kesh Jig (album version)']);

	await clipMenu(page, 'Kesh Jig (album version)', 'Move up');
	await expect.poll(titles).toEqual(['first', 'Kesh Jig (album version)', 'Link recording']);
	await clipMenu(page, 'first', 'Move down');
	await expect.poll(titles).toEqual(['Kesh Jig (album version)', 'first', 'Link recording']);

	// Drag the last one to the top by its handle.
	if (!isMobile(info)) {
		const handle = clip(page, 'Link recording').getByTitle('Drag to reorder');
		const from = (await handle.boundingBox())!;
		const to = (await clip(page, 'Kesh Jig (album version)').boundingBox())!;
		await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
		await page.mouse.down();
		await page.mouse.move(from.x + from.width / 2, to.y + 4, { steps: 8 });
		await page.mouse.up();
		await expect.poll(titles).toEqual(['Link recording', 'Kesh Jig (album version)', 'first']);
	}
	const before = await titles();
	await page.reload();
	await expect.poll(titles).toEqual(before);

	await clipMenu(page, 'first', 'Remove');
	await expect(clips(page)).toHaveCount(2);
	await page.getByRole('button', { name: 'Undo' }).click();
	await expect.poll(titles).toEqual(before);
});

test('plays a kept-offline recording with no network', async ({ page, context }, info) => {
	await page.evaluate(() => navigator.serviceWorker.ready);
	await addTune(page, info, { title: 'Offline Polka' });
	await openPiece(page, 'Offline Polka');
	await upload(page, 'offline.wav', 3);
	await expect(clips(page)).toHaveCount(1);
	await expect(clip(page, 'offline').getByRole('button', { name: 'Keep offline' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);

	await context.setOffline(true);
	await page.reload();
	await expect(page.getByRole('heading', { level: 1, name: 'Offline Polka' })).toBeVisible();
	await clip(page, 'offline').getByRole('button', { name: 'Play offline' }).click();
	await expect(player(page)).toHaveAttribute('data-playing', 'true');
	await expect.poll(() => time(page)).toBeGreaterThan(0.3);
	await context.setOffline(false);

	// Settings shows what's stored.
	await backToList(page, info);
	await page.getByRole('link', { name: 'Settings' }).click();
	await expect(page.getByTestId('audio-usage')).toHaveText(
		/Recordings on this device: 1\s+file, \d+ KB\s+\(1\s+kept offline, \d+ KB\)\./
	);
});

test('has/lacks recordings filter', async ({ page }, info) => {
	await addTune(page, info, { title: 'With Audio' });
	await addTune(page, info, { title: 'Without Audio' });
	await openPiece(page, 'With Audio');
	await pasteLink(page, YT_URL);
	await expect(clips(page)).toHaveCount(1);
	await backToList(page, info);

	await page.getByRole('button', { name: /Filter & sort/ }).click();
	const filter = page.getByRole('combobox', { name: 'Recordings', exact: true });
	await filter.selectOption('has');
	await expect(card(page, 'With Audio')).toBeVisible();
	await expect(card(page, 'Without Audio')).toBeHidden();
	await filter.selectOption('lacks');
	await expect(card(page, 'With Audio')).toBeHidden();
	await expect(card(page, 'Without Audio')).toBeVisible();
	await page.getByRole('button', { name: 'Clear filters' }).click();
	await expect(card(page, 'With Audio')).toBeVisible();
});

/** Submits a multipart POST navigation to the share target, as Android's share sheet does. */
async function share(
	page: Page,
	fields: Record<string, string>,
	file?: { name: string; bytes: number[] }
) {
	await page.evaluate(
		({ fields, file }) => {
			const form = document.createElement('form');
			form.method = 'post';
			form.enctype = 'multipart/form-data';
			form.action = '/share-target';
			for (const [name, value] of Object.entries(fields)) {
				const input = document.createElement('input');
				input.type = 'hidden';
				input.name = name;
				input.value = value;
				form.append(input);
			}
			if (file) {
				const input = document.createElement('input');
				input.type = 'file';
				input.name = 'audio';
				const dt = new DataTransfer();
				dt.items.add(new File([new Uint8Array(file.bytes)], file.name, { type: 'audio/wav' }));
				input.files = dt.files;
				form.append(input);
			}
			document.body.append(form);
			form.submit();
		},
		{ fields, file }
	);
}

async function controlled(page: Page) {
	await page.evaluate(() => navigator.serviceWorker.ready);
	if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) {
		await page.reload();
		await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
	}
}

test('a recording shared from another app lands on the Shared page', async ({ page }) => {
	await controlled(page);
	await share(page, { title: 'Recorder' }, { name: 'Recorder take.wav', bytes: [...wav(2)] });
	await expect(page).toHaveURL(/\/shared\?received=1$/);
	await expect(page.getByRole('heading', { name: 'Shared recording' })).toBeVisible();
	const item = page.getByRole('listitem', { name: 'Recorder take.wav' });
	await expect(item).toContainText('Recorder take.wav');
	await item.getByLabel('Recording title').fill('Session take');
	await item.getByRole('button', { name: 'New tune' }).click();

	// A new tune with the recording, and the edit modal to name it.
	const dialog = page.getByRole('dialog');
	await expect(dialog.getByRole('heading', { name: 'New tune' })).toBeVisible();
	await dialog.getByLabel('Title').fill('Shared Reel');
	await dialog.getByRole('button', { name: 'Done' }).click();
	await expect(page.getByRole('heading', { level: 1, name: 'Shared Reel' })).toBeVisible();
	const row = clip(page, 'Session take');
	await expect(row).toContainText('Not backed up');
	await row.getByRole('button', { name: 'Play Session take' }).click();
	await expect(player(page)).toHaveAttribute('data-playing', 'true');

	// The inbox is empty again; the old spike page forwards here.
	await page.goto('/spike/share');
	await expect(page).toHaveURL(/\/shared$/);
	await expect(page.getByText('Nothing waiting.')).toBeVisible();
});

test('a link shared from another app attaches to an existing piece', async ({ page }, info) => {
	await addTune(page, info, { title: 'Existing Slide' });
	await controlled(page);
	await share(page, { title: 'Great tune', text: `Watch this ${YT_URL}` });
	await expect(page).toHaveURL(/\/shared\?received=1$/);
	const item = page.getByRole('listitem', { name: 'Great tune' });
	await expect(item).toContainText('YouTube');
	await item.getByLabel('Add to a piece').fill('slide');
	await item.getByRole('button', { name: 'Add to Existing Slide' }).click();
	await expect(page.getByRole('heading', { level: 1, name: 'Existing Slide' })).toBeVisible();
	// The shared title names the recording.
	await expect(clip(page, 'Great tune')).toContainText('YouTube');
});
