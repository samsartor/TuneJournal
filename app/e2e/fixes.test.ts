// Regression tests for the fixes after the M6 review (PLAN.md §14, "Fixes after M6 review").

import { expect, test, type Locator, type Page } from '@playwright/test';
import { RELAY, addTune, backToList, card, isMobile, open } from './helpers';
import { YT_URL, mockMedia, wav } from './media';
import { addCooleys, fixture, mockTheSession, picker } from './thesession';

test.beforeEach(async ({ page }) => {
	await page.routeWebSocket(RELAY, (ws) => ws.close());
});

const detail = (page: Page) => page.locator('.detail');
const player = (page: Page) => page.getByTestId('player');
const clip = (page: Page, name: string | RegExp) => page.getByRole('listitem', { name });

/** Uncaught errors, and SvelteKit's error page, both count as failures. */
function watchErrors(page: Page) {
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message));
	return errors;
}

async function openPiece(page: Page, title: string) {
	await card(page, title).getByRole('link', { name: title }).click();
	await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
}

async function clipMenu(page: Page, name: string | RegExp) {
	await clip(page, name)
		.getByRole('button', { name: /^Actions for/ })
		.click();
	return page.getByRole('menu');
}

async function upload(page: Page, name: string, seconds = 6) {
	await page
		.getByLabel('Upload a file')
		.setInputFiles({ name, mimeType: 'audio/wav', buffer: wav(seconds) });
	await expect(clip(page, name.replace(/\.wav$/, ''))).toBeVisible();
}

async function expectInViewport(page: Page, locator: Locator) {
	const box = (await locator.boundingBox())!;
	const viewport = page.viewportSize()!;
	expect(box.y).toBeGreaterThanOrEqual(0);
	expect(box.x).toBeGreaterThanOrEqual(0);
	expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
	expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
}

test('a tune whose thesession sets repeat opens without an error', async ({ page }, info) => {
	// thesession.org lists some sets twice (set 150333 on /tunes/4428/sets, say), which crashed the
	// "Appears in sets" list with each_key_duplicate and a bare "500 Internal Error".
	const sets = JSON.parse(fixture('tune-1-sets.json'));
	sets.sets = [sets.sets[0], ...sets.sets, sets.sets[1]];
	await mockTheSession(page, { '/tunes/1/sets': JSON.stringify(sets) });
	const errors = watchErrors(page);
	await open(page);
	const dialog = await addCooleys(page, info, "Cooley's");
	await dialog.getByRole('button', { name: /^Setting 1,/ }).click();
	await dialog.getByRole('button', { name: 'Done' }).click();

	const list = detail(page).getByRole('list', { name: 'Appears in sets' });
	await expect(list.locator(':scope > li')).toHaveCount(2);
	await expect(page.getByTestId('error-page')).toHaveCount(0);

	// Leaving and coming back (client-side) is fine too.
	await backToList(page, info);
	await openPiece(page, "Cooley's");
	await expect(list.locator(':scope > li')).toHaveCount(2);
	expect(errors).toEqual([]);
});

test('the error page explains and leads back to the list', async ({ page }) => {
	await open(page);
	await page.goto('/no/such/page');
	const error = page.getByTestId('error-page');
	await expect(error.getByRole('heading', { name: 'Page not found' })).toBeVisible();
	await error.getByRole('link', { name: 'Back to list' }).click();
	await expect(page.getByRole('searchbox', { name: 'Search' })).toBeVisible();
});

test('overflow menus open inside the viewport, wherever their button is', async ({
	page
}, info) => {
	await open(page);
	await addTune(page, info, { title: 'Menu Reel' });
	await openPiece(page, 'Menu Reel');

	// The detail view's menu is at the very top: it used to open upwards, off the screen.
	await detail(page).getByRole('button', { name: 'More actions for Menu Reel' }).click();
	const menu = page.getByRole('menu');
	await expect(menu).toBeVisible();
	await expectInViewport(page, menu);
	const button = await detail(page)
		.getByRole('button', { name: 'More actions for Menu Reel' })
		.boundingBox();
	expect((await menu.boundingBox())!.y).toBeGreaterThan(button!.y);
	await page.keyboard.press('Escape');
	await expect(menu).toBeHidden();

	// A card's menu, too.
	await backToList(page, info);
	await card(page, 'Menu Reel').getByRole('button', { name: 'More actions for Menu Reel' }).click();
	await expect(menu).toBeVisible();
	await expectInViewport(page, menu);
	await menu.getByRole('menuitem', { name: 'Edit' }).click();
	await expect(page.getByRole('dialog')).toBeVisible();
});

test('the skill slider keeps its width while it moves, in every view', async ({ page }, info) => {
	await open(page);
	await addTune(page, info, { title: 'Slider Jig' });
	await openPiece(page, 'Slider Jig');

	async function check(scope: Locator) {
		const slider = scope.getByRole('slider', { name: 'Skill' });
		const before = (await slider.boundingBox())!;
		await slider.fill('4');
		const clear = scope.getByRole('button', { name: 'Clear rating' });
		await expect(clear).toBeVisible();
		const after = (await slider.boundingBox())!;
		expect(after.width).toBe(before.width);
		expect(after.y).toBe(before.y);
		// "Clear rating" sits in the header row, above the slider, not beside it.
		const clearBox = (await clear.boundingBox())!;
		expect(clearBox.y + clearBox.height).toBeLessThanOrEqual(after.y + 1);
		await slider.fill('2');
		expect((await slider.boundingBox())!.width).toBe(before.width);
		await clear.click();
		await expect(clear).toBeHidden();
		expect((await slider.boundingBox())!.width).toBe(before.width);
	}

	await check(detail(page));
	await detail(page).getByRole('button', { name: 'Edit' }).click();
	await check(page.getByRole('dialog'));
	await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();

	await page.goto('/shuffle');
	await expect(page.getByTestId('shuffle-card')).toBeVisible();
	await check(page.locator('.actions'));
});

test('a thesession recording’s tune and setting can be changed, and the tune inherits its key', async ({
	page
}, info) => {
	await mockTheSession(page);
	await open(page);
	const dialog = await addCooleys(page, info, "Cooley's");
	await dialog.getByRole('button', { name: /^Setting 2, E min:/ }).click();
	await dialog.getByRole('button', { name: 'Done' }).click();
	await expect(detail(page).getByTestId('key')).toHaveText(/E min\s+from thesession\.org/);

	// "Edit…" (was "Details…") on the thesession recording shows the setting's key and notes.
	const menu = await clipMenu(page, 'thesession.org');
	await expect(menu.getByRole('menuitem', { name: 'Open link ↗' })).toHaveAttribute(
		'href',
		'https://thesession.org/tunes/1'
	);
	await menu.getByRole('menuitem', { name: 'Edit…' }).click();
	const edit = page.getByRole('dialog', { name: 'Edit recording' });
	await expect(edit.getByTestId('linked-tune')).toHaveText("Cooley's, setting 2");
	await expect(edit.getByLabel('Key as text')).toHaveValue('E minor');
	await expect(edit.getByLabel('First notes (ABC)')).toHaveValue('F | CGGC G2 CG | G2 FG BGFE');

	// Another setting: its key and first notes replace the old ones.
	await edit.getByRole('button', { name: 'Change setting…' }).click();
	const settings = picker(page);
	await expect(settings).toHaveAccessibleName('Choose a setting');
	const current = settings.getByRole('button', { name: /^Setting 2,/ });
	await expect(current).toHaveAttribute('aria-current', 'true');
	await settings.getByRole('button', { name: /^Setting 1, E dor:/ }).click();
	await expect(settings).toBeHidden();
	await expect(edit.getByTestId('linked-tune')).toHaveText("Cooley's, setting 1");
	await expect(edit.getByLabel('Key as text')).toHaveValue('E dorian');
	await expect(edit.getByLabel('First notes (ABC)')).toHaveValue('D2 | EBBA B2 EB | B2 AB dBAG');
	await edit.getByRole('button', { name: 'Done' }).click();
	await expect(detail(page).getByTestId('key')).toHaveText(/E dor\s+from thesession\.org/);
	await expect(detail(page).getByTestId('first-notes')).toHaveText(/D2 \| EBBA B2 EB/);

	// The tune's own key wins over the recording's.
	await detail(page).getByRole('button', { name: 'Edit' }).click();
	const modal = page.getByRole('dialog');
	await modal.getByLabel('Key as text').fill('A maj');
	await expect(
		modal.getByRole('button', { name: 'Use thesession.org’s key (E dor)' })
	).toBeVisible();
	await modal.getByRole('button', { name: 'Done' }).click();
	await expect(detail(page).getByTestId('key')).toHaveText('A maj');
	await backToList(page, info);
	await expect(card(page, "Cooley's").getByText('A maj')).toBeVisible();
	await openPiece(page, "Cooley's");
	await detail(page).getByRole('button', { name: 'Edit' }).click();
	await modal.getByRole('button', { name: 'Use thesession.org’s key (E dor)' }).click();
	await modal.getByRole('button', { name: 'Done' }).click();
	await expect(detail(page).getByTestId('key')).toHaveText(/E dor\s+from thesession\.org/);

	// Another tune altogether, through the same search as the edit modal's.
	await (await clipMenu(page, 'thesession.org')).getByRole('menuitem', { name: 'Edit…' }).click();
	await edit.getByRole('button', { name: 'Change tune…' }).click();
	await picker(page)
		.getByRole('list', { name: 'thesession.org results' })
		.getByRole('button', { name: /^Seamus Cooley's/ })
		.click();
	await picker(page).getByRole('button', { name: 'Keep my title' }).click();
	// The fixtures have no settings for that tune.
	await expect(picker(page).getByText(/couldn’t load its settings/)).toBeVisible();
	await picker(page).getByRole('button', { name: 'Done' }).click();
	await expect(picker(page)).toBeHidden();
	await edit.getByRole('button', { name: 'Done' }).click();
	await expect(
		clip(page, 'thesession.org').getByRole('link', { name: /Open thesession\.org/ })
	).toHaveAttribute('href', 'https://thesession.org/tunes/414');
	await expect(detail(page).getByTestId('key')).toHaveText('—');
});

test('a link can be corrected, and every recording opens its link', async ({ page }, info) => {
	await mockMedia(page);
	await open(page);
	await addTune(page, info, { title: 'Link Reel' });
	await openPiece(page, 'Link Reel');
	await page.getByLabel('YouTube, Spotify or other link').fill(YT_URL);
	await page.getByRole('button', { name: 'Add link' }).click();
	const yt = clip(page, 'The Kesh — live session');
	await expect(yt).toBeVisible();

	let menu = await clipMenu(page, 'The Kesh — live session');
	const openLink = menu.getByRole('menuitem', { name: 'Open link ↗' });
	await expect(openLink).toHaveAttribute('href', YT_URL);
	await expect(openLink).toHaveAttribute('target', '_blank');
	await menu.getByRole('menuitem', { name: 'Edit…' }).click();
	const edit = page.getByRole('dialog', { name: 'Edit recording' });
	const link = edit.getByLabel('Link');
	await expect(link).toHaveValue(YT_URL);
	await link.fill('not a link');
	await edit.getByRole('button', { name: 'Update link' }).click();
	await expect(edit.getByText('That doesn’t look like a link.')).toBeVisible();
	await link.fill('https://youtu.be/abcdefghijk?t=12');
	await edit.getByRole('button', { name: 'Update link' }).click();
	await expect(edit.getByRole('status')).toHaveText('Now linked to YouTube.');
	await expect(link).toHaveValue('https://www.youtube.com/watch?v=abcdefghijk');
	// Its own title, key and notes are still there to edit; and it can be trimmed from here.
	await expect(edit.getByLabel('Title')).toBeVisible();
	await expect(edit.getByLabel('Key as text')).toBeVisible();
	await expect(edit.getByRole('button', { name: 'Trim…' })).toBeVisible();
	await edit.getByRole('button', { name: 'Done' }).click();
	await expect(yt.getByTestId('clip-trim')).toHaveText('0:12–end');
	menu = await clipMenu(page, 'The Kesh — live session');
	await expect(menu.getByRole('menuitem', { name: 'Open link ↗' })).toHaveAttribute(
		'href',
		'https://www.youtube.com/watch?v=abcdefghijk'
	);
	await page.keyboard.press('Escape');

	// An upload that's only on this device can be saved as a file instead.
	await page.getByRole('button', { name: '+ Add recording' }).click();
	await upload(page, 'only-here.wav', 2);
	menu = await clipMenu(page, 'only-here');
	await expect(menu.getByRole('menuitem', { name: 'Open link ↗' })).toHaveCount(0);
	const [download] = await Promise.all([
		page.waitForEvent('download'),
		menu.getByRole('menuitem', { name: 'Download file' }).click()
	]);
	expect(download.suggestedFilename()).toBe('only-here.wav');
});

test('the trim editor has its own transport, in Trim and in Split', async ({ page }, info) => {
	await mockMedia(page);
	await open(page);
	await addTune(page, info, { title: 'Transport Reel' });
	await openPiece(page, 'Transport Reel');
	await upload(page, 'transport.wav', 6);

	await (await clipMenu(page, 'transport')).getByRole('menuitem', { name: 'Trim…' }).click();
	const dialog = page.getByRole('dialog', { name: /Trim/ });
	await expect(dialog.getByText('Drawing the waveform…')).toBeHidden();
	await expect(dialog.locator('canvas')).toBeVisible();
	await expect(dialog.getByText('of 0:06')).toBeVisible();
	const head = dialog.getByTestId('trim-playhead');
	const seconds = async () => {
		const [m, s] = (await head.textContent())!.split(':');
		return Number(m) * 60 + Number(s);
	};

	// Play and pause, through the global player (its bar is behind the dialog).
	await dialog.getByRole('button', { name: 'Play', exact: true }).click();
	await expect.poll(seconds).toBeGreaterThan(0.4);
	await expect(player(page)).toHaveAttribute('data-playing', 'true');
	// The whole recording plays while trimming, not just the clip.
	await expect(player(page)).toHaveAttribute('data-end', '6.00');
	await dialog.getByRole('button', { name: 'Pause' }).click();
	await expect(player(page)).toHaveAttribute('data-playing', 'false');

	// Scrub on the waveform, then put the start flag at the playhead.
	const lane = dialog.getByTestId('trim-lane');
	const box = (await lane.boundingBox())!;
	await lane.click({ position: { x: box.width / 2, y: 10 } });
	await expect.poll(seconds).toBeCloseTo(3, 0);
	await dialog.getByRole('button', { name: 'Set start at playhead' }).click();
	await expect(dialog.getByLabel('Start', { exact: true })).toHaveValue(/^0:0[23]\.\d$/);
	// The end flag drags (here: keyboard-style fill) and the typed times follow.
	await dialog.getByRole('slider', { name: 'End flag' }).fill('5');
	await expect(dialog.getByLabel('End', { exact: true })).toHaveValue('0:05.0');
	// The playhead slider is the keyboard path to scrubbing.
	await dialog.getByRole('slider', { name: 'Playhead' }).fill('4.5');
	await expect.poll(seconds).toBeCloseTo(4.5, 0);
	await dialog.getByRole('button', { name: 'Set end at playhead' }).click();
	await expect(dialog.getByLabel('End', { exact: true })).toHaveValue('0:04.5');

	// Looping the region plays only it.
	await dialog.getByRole('button', { name: 'Preview (loop)' }).click();
	await expect(player(page)).toHaveAttribute('data-playing', 'true');
	await expect(player(page)).toHaveAttribute('data-end', '4.50');
	await dialog.getByRole('button', { name: 'Stop preview' }).click();
	await expect(player(page)).toHaveAttribute('data-playing', 'false');
	await dialog.getByRole('button', { name: 'Save trim' }).click();
	await expect(dialog).toBeHidden();
	await expect(clip(page, 'transport').getByTestId('clip-trim')).toHaveText(/^0:0[23]–0:04$/);
	// Back to the clip's own bounds.
	await expect(player(page)).toHaveAttribute('data-end', '4.50');

	// Split reuses the editor, transport included.
	await page
		.getByRole('region', { name: 'Related' })
		.getByRole('button', { name: 'Split Part' })
		.click();
	const split = page.getByRole('dialog', { name: 'Split Part' });
	await split.getByRole('button', { name: 'Play', exact: true }).click();
	await expect(player(page)).toHaveAttribute('data-playing', 'true');
	await expect(split.getByRole('slider', { name: 'Start flag' })).toBeVisible();
	await split.getByRole('button', { name: 'Cancel' }).click();
	await expect(split).toBeHidden();
	await expect(player(page)).toHaveAttribute('data-playing', 'false');
});

test('pages end where their content does, with and without the player', async ({ page }, info) => {
	await mockMedia(page);
	await open(page);
	await addTune(page, info, { title: 'Long Reel' });
	await openPiece(page, 'Long Reel');
	// A long description pushes the recordings panel (with its hidden file input) far down.
	await detail(page).getByRole('button', { name: 'Edit' }).click();
	const modal = page.getByRole('dialog');
	await modal
		.getByLabel('Description')
		.fill(Array.from({ length: 80 }, (_, i) => `Line ${i}`).join('\n'));
	await modal.getByRole('button', { name: 'Done' }).click();
	await expect(detail(page).getByText('Line 79')).toBeVisible();

	async function expectNoOverscroll() {
		const m = await page.evaluate(() => {
			const doc = document.scrollingElement!;
			const article = document.querySelector('.detail')!.getBoundingClientRect();
			const pad = parseFloat(getComputedStyle(document.body).paddingBottom) || 0;
			return {
				scroll: doc.scrollHeight,
				view: innerHeight,
				contentEnd: article.bottom + scrollY + pad
			};
		});
		if (isMobile(info)) {
			// The page scrolls, and only as far as the detail view (plus room for the player).
			expect(m.scroll).toBeLessThanOrEqual(Math.ceil(m.contentEnd) + 1);
		} else {
			// The panes scroll; the page itself never does.
			expect(m.scroll).toBeLessThanOrEqual(m.view);
		}
	}

	await expectNoOverscroll();
	await page.getByLabel('Upload a file').setInputFiles({
		name: 'long.wav',
		mimeType: 'audio/wav',
		buffer: wav(2)
	});
	await clip(page, 'long').getByRole('button', { name: 'Play long' }).click();
	await expect(player(page)).toBeVisible();
	await expectNoOverscroll();
	// The end of the detail view can be scrolled clear of the player bar.
	const last = detail(page).getByRole('heading', { name: 'Practice history' });
	await last.scrollIntoViewIfNeeded();
	await page.evaluate(() => {
		document.scrollingElement!.scrollTop = 1e6;
		document.querySelector('.pane')?.scrollTo(0, 1e6);
	});
	const barTop = (await player(page).boundingBox())!.y;
	const end = (await detail(page).getByText('Not practiced yet.').boundingBox())!;
	expect(end.y + end.height).toBeLessThanOrEqual(barTop);
});

/** Google Identity Services and Drive, stubbed: any client ID gets a token. */
async function mockGoogle(page: Page) {
	const context = page.context();
	await context.route('https://accounts.google.com/gsi/client', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'text/javascript',
			body: `window.__gis = { clientIds: [] };
window.google = Object.assign(window.google || {}, { accounts: { oauth2: {
	initTokenClient(cfg) {
		window.__gis.clientIds.push(cfg.client_id);
		return { requestAccessToken() { setTimeout(() => cfg.callback({ access_token: 'token', expires_in: 3600 }), 10); } };
	},
	revoke(token, done) { if (done) done(); }
} } });`
		})
	);
	const drive: string[] = [];
	await context.route(/^https:\/\/www\.googleapis\.com\/drive\/v3\/files/, (route) => {
		const headers = {
			'access-control-allow-origin': '*',
			'access-control-allow-headers': 'authorization, content-type'
		};
		if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
		drive.push(route.request().headers().authorization ?? '');
		return route.fulfill({
			status: 200,
			contentType: 'application/json',
			headers,
			body: JSON.stringify({ files: [] })
		});
	});
	return drive;
}

test('Google Drive can be set up at runtime, on this device only', async ({
	page,
	baseURL
}, info) => {
	const drive = await mockGoogle(page);
	await open(page);
	await addTune(page, info, { title: 'Drive Jig' });
	await openPiece(page, 'Drive Jig');
	const addPanel = page.getByRole('group', { name: 'Add a recording' });
	await expect(addPanel).toBeVisible();
	await expect(addPanel.getByRole('button', { name: 'Google Drive' })).toHaveCount(0);

	await page.goto('/settings');
	const section = page.getByTestId('drive-settings');
	await expect(section.getByTestId('drive-status')).toHaveText(/Not set up yet/);
	await expect(section.getByTestId('drive-origin')).toHaveText(new URL(baseURL!).origin);
	await expect(section.getByText('Authorized JavaScript origins')).toBeVisible();
	await section.getByLabel('OAuth client ID').fill('1234-test.apps.googleusercontent.com');
	await section.getByLabel('API key').fill('AIzaTestKey');
	await section.getByLabel('App ID (project number)').fill('not-a-number');
	await expect(section.getByText('The app ID is the project number: digits only.')).toBeVisible();
	await section.getByLabel('App ID (project number)').fill('1234');
	await section.getByRole('button', { name: 'Save' }).click();
	await expect(section.getByTestId('drive-status')).toHaveText(
		'Set up with settings saved on this device.'
	);

	await section.getByRole('button', { name: 'Test connection' }).click();
	await expect(section.getByTestId('drive-test')).toHaveText(/It works/);
	expect(
		await page.evaluate(
			() => (window as unknown as { __gis: { clientIds: string[] } }).__gis.clientIds
		)
	).toEqual(['1234-test.apps.googleusercontent.com']);
	expect(drive).toEqual(['Bearer token']);
	await expect(section.getByText('Connected on this device.')).toBeVisible();

	// Saved on the device (it survives a reload), but never in the synced library.
	await page.reload();
	await expect(section.getByTestId('drive-status')).toHaveText(
		'Set up with settings saved on this device.'
	);
	const [json] = await Promise.all([
		page.waitForEvent('download'),
		page.getByRole('button', { name: 'Export JSON' }).click()
	]);
	const exported = await (await json.createReadStream()).toArray();
	expect(Buffer.concat(exported).toString()).not.toContain('1234-test');

	// Drive shows up elsewhere without a rebuild.
	await page.getByRole('link', { name: '← All pieces' }).click();
	await openPiece(page, 'Drive Jig');
	await expect(addPanel.getByRole('button', { name: 'Google Drive' })).toBeVisible();

	// Removing them hides Drive again.
	await page.goto('/settings');
	await section.getByRole('button', { name: 'Change Google Cloud settings…' }).click();
	await section.getByRole('button', { name: 'Remove saved settings' }).click();
	await expect(section.getByTestId('drive-status')).toHaveText(/Not set up yet/);
});
