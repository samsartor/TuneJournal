// The thesession.org tune and setting pickers (PLAN.md §6.3): views of their own that cover the
// edit modal or a recording's Edit dialog, with previews synthesized by the real abcjs renderer.

import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { RELAY, isMobile, open } from './helpers';
import { addCooleys, mockTheSession, picker, searchTheSession } from './thesession';

test.beforeEach(async ({ page }) => {
	await page.routeWebSocket(RELAY, (ws) => ws.close());
	// Every media element that's ever played, so a test can tell whether anything still sounds.
	await page.addInitScript(() => {
		const media: HTMLMediaElement[] = [];
		(window as unknown as { __media: HTMLMediaElement[] }).__media = media;
		const play = HTMLMediaElement.prototype.play;
		HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
			if (!media.includes(this)) media.push(this);
			return play.call(this);
		};
	});
	await mockTheSession(page);
	await open(page);
});

/** Media elements playing right now. */
const sounding = (page: Page) =>
	page.evaluate(
		() =>
			(window as unknown as { __media: HTMLMediaElement[] }).__media.filter((m) => !m.paused).length
	);

const player = (page: Page) => page.getByTestId('player');

/** Optional screenshots for review: SHOTS=<dir> npm run test:e2e -- pickers */
async function shot(page: Page, info: TestInfo, name: string) {
	const dir = process.env.SHOTS;
	if (dir) await page.screenshot({ path: `${dir}/${info.project.name}-${name}.png` });
}

/** Nothing on the page, or in the picker's list, scrolls sideways. */
async function expectNoSideScroll(page: Page, dialog: Locator) {
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
		true
	);
	for (const el of await dialog.locator('.body, .row').all()) {
		expect(await el.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
	}
}

async function openAdd(page: Page, info: TestInfo) {
	if (isMobile(info)) await page.getByRole('button', { name: 'Add tune' }).click();
	else await page.getByRole('button', { name: 'Add +' }).click();
	const edit = page.getByRole('dialog', { name: 'New tune' });
	await expect(edit).toBeVisible();
	return edit;
}

test('the tune picker covers the edit modal, and cancelling goes back with the edits', async ({
	page
}, info) => {
	const edit = await openAdd(page, info);
	await edit.getByLabel('Description').fill('From the session on Tuesday');
	const results = await searchTheSession(page, 'cooley');
	const tunes = picker(page);
	await expect(tunes).toHaveAccessibleName('Find a tune on thesession.org');
	await expect(edit).toBeHidden();
	await expect(tunes.getByLabel('Tune name')).toHaveValue('cooley');
	await expect(tunes.getByLabel('Tune name')).toBeFocused();

	// What a result shows: type, meter, the alias it matched.
	const hornpipe = results.getByRole('listitem').filter({ hasText: 'Hornpipe' });
	await expect(hornpipe).toContainText('Hornpipe');
	await expect(hornpipe).toContainText('4/4');
	await expect(hornpipe).toContainText("aka Joe Cooley's");
	await expect(hornpipe.getByRole('button', { name: "Preview Cooley's" })).toBeVisible();
	await expectNoSideScroll(page, tunes);
	if (!isMobile(info)) {
		// On a desktop it takes the edit modal's place, not the whole screen.
		const box = (await tunes.boundingBox())!;
		expect(box.width).toBeLessThan(700);
		expect(box.x).toBeGreaterThan(100);
	}
	await shot(page, info, 'tune-picker');

	// × goes back to the edit modal, as it was.
	await tunes.getByRole('button', { name: 'Close' }).click();
	await expect(tunes).toBeHidden();
	await expect(edit).toBeVisible();
	await expect(edit.getByLabel('Title')).toHaveValue('cooley');
	await expect(edit.getByLabel('Description')).toHaveValue('From the session on Tuesday');
	await expect(edit.getByRole('button', { name: 'Search thesession.org' })).toBeFocused();

	// So does Escape, even from the search box, and only the picker closes.
	await edit.getByRole('button', { name: 'Search thesession.org' }).click();
	await expect(tunes.getByLabel('Tune name')).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(tunes).toBeHidden();
	await expect(edit).toBeVisible();
	await expect(edit.getByLabel('Title')).toHaveValue('cooley');
	await expect(edit.getByLabel('Description')).toHaveValue('From the session on Tuesday');

	// The tune picked last time shows more once it's been loaded: settings, keys, tunebooks.
	await edit.getByRole('button', { name: 'Search thesession.org' }).click();
	await tunes
		.getByRole('list', { name: 'thesession.org results' })
		.getByRole('button', { name: /^Cooley's\s+Reel/ })
		.click();
	await tunes.getByRole('button', { name: "Use “Cooley's”" }).click();
	await expect(tunes).toHaveAccessibleName('Choose a setting');
	await tunes.getByRole('button', { name: 'Back to search results' }).click();
	await expect(tunes).toHaveAccessibleName('Find a tune on thesession.org');
	const reel = tunes.getByRole('listitem').filter({ hasText: /Cooley's\s*Reel/ });
	await expect(reel).toContainText('3 settings (E min ×2, E dor) · 6,826 tunebooks');
	await expect(reel).toContainText(
		"Also Joe Cooley, Joe Cooley's, Joe Cooley's Fancy, Luttrell's Pass…"
	);
	await page.keyboard.press('Escape');
	await expect(edit).toBeVisible();
	await expect(edit.getByLabel('Description')).toHaveValue('From the session on Tuesday');
});

test('choose a tune, preview its settings, then choose one', async ({ page }, info) => {
	test.setTimeout(90_000);
	const dialog = await addCooleys(page, info, "Cooley's");
	const settings = picker(page);
	await expect(settings).toHaveAccessibleName('Choose a setting');
	await expect(settings.getByText("“Cooley's” has 3 settings.")).toBeVisible();

	// Each setting: key, meter, who posted it and when, and its opening bars drawn.
	const rows = settings.getByRole('list').getByRole('listitem');
	await expect(rows).toHaveCount(3);
	await expect(rows.nth(0)).toContainText('E dor');
	await expect(rows.nth(0)).toContainText('4/4');
	await expect(rows.nth(0)).toContainText('Jeremy, 14 May 2001');
	await expect(rows.nth(1)).toContainText('donnchad, 11 Jun 2002');
	await expect(rows.nth(0).getByTestId('incipit')).toHaveAttribute('data-drawn', 'true', {
		timeout: 15_000
	});
	await expect(rows.nth(0).locator('svg')).toBeVisible();
	await expectNoSideScroll(page, settings);

	// Preview: plays, and stops again.
	const first = settings.getByRole('button', { name: 'Preview setting 1' });
	await first.click();
	await expect(first).toHaveAttribute('aria-pressed', 'true');
	await expect(first).toHaveAttribute('data-state', 'playing', { timeout: 20_000 });
	await expect.poll(() => sounding(page)).toBe(1);
	await shot(page, info, 'setting-picker');
	await first.click();
	await expect(first).toHaveAttribute('aria-pressed', 'false');
	await expect.poll(() => sounding(page)).toBe(0);

	// One at a time: starting another stops the first.
	const second = settings.getByRole('button', { name: 'Preview setting 2' });
	await first.click();
	await expect(first).toHaveAttribute('data-state', 'playing', { timeout: 20_000 });
	await second.click();
	await expect(first).toHaveAttribute('aria-pressed', 'false');
	await expect(second).toHaveAttribute('data-state', 'playing', { timeout: 20_000 });
	await expect.poll(() => sounding(page)).toBe(1);

	// The preview speed re-renders at that tempo.
	const speed = settings.getByRole('group', { name: 'Preview speed' });
	await speed.getByRole('button', { name: '75% speed' }).click();
	await expect(speed.getByRole('button', { name: '75% speed' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await expect(second).toHaveAttribute('data-state', 'playing');

	// Choosing closes the picker, which stops the preview. Nothing was added but the choice.
	await settings.getByRole('button', { name: /^Setting 1, E dor:/ }).click();
	await expect(settings).toBeHidden();
	await expect.poll(() => sounding(page)).toBe(0);
	await expect(dialog.getByLabel('Title')).toHaveValue("Cooley's");
	await expect(dialog.getByTestId('key-inherited')).toHaveText(
		'Uses E dor from thesession.org until you set one.'
	);
	await dialog.getByRole('button', { name: 'Done' }).click();
	const recordings = page.locator('.detail').getByRole('listitem', { name: 'thesession.org' });
	await expect(recordings).toHaveCount(1);
	await expect(player(page)).toBeHidden();

	// Setting 1, heard at 100%, is already rendered in the audio cache.
	const cached = await page.evaluate(async () => {
		const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('audio');
		const names: string[] = [];
		for await (const [name] of dir as unknown as AsyncIterable<[string, unknown]>) {
			names.push(decodeURIComponent(name));
		}
		return names;
	});
	expect(
		cached.some((n) => n.startsWith('synth:') && n.includes(':s1:') && n.endsWith('@1.00'))
	).toBe(true);
});

test('a tune can be previewed from the results, and closing the picker stops it', async ({
	page
}, info) => {
	test.setTimeout(60_000);
	await openAdd(page, info);
	const results = await searchTheSession(page, 'cooley');
	const play = results.getByRole('button', { name: "Preview Cooley's" }).first();
	await play.click();
	await expect(play).toHaveAttribute('data-state', 'playing', { timeout: 20_000 });
	await expect.poll(() => sounding(page)).toBe(1);

	// A tune without settings says so on its own row.
	const seamus = results.getByRole('button', { name: "Preview Seamus Cooley's" });
	await seamus.click();
	await expect(play).toHaveAttribute('aria-pressed', 'false');
	await expect(
		results.getByRole('listitem').filter({ hasText: "Seamus Cooley's" }).getByRole('alert')
	).toBeVisible();

	await play.click();
	await expect(play).toHaveAttribute('data-state', 'playing', { timeout: 20_000 });
	await picker(page).getByRole('button', { name: 'Close' }).click();
	await expect(picker(page)).toBeHidden();
	await expect.poll(() => sounding(page)).toBe(0);
	await expect(page.getByRole('dialog', { name: 'New tune' })).toBeVisible();
});

test('the recording’s Edit dialog changes the setting and the tune in the pickers', async ({
	page
}, info) => {
	test.setTimeout(90_000);
	const dialog = await addCooleys(page, info, "Cooley's");
	await picker(page)
		.getByRole('button', { name: /^Setting 2, E min:/ })
		.click();
	await dialog.getByRole('button', { name: 'Done' }).click();

	// The main player plays the tune; a preview pauses it.
	const detail = page.locator('.detail');
	const row = detail.getByRole('listitem', { name: 'thesession.org' });
	await row.getByRole('button', { name: 'Play thesession.org' }).click();
	await expect(player(page)).toHaveAttribute('data-playing', 'true', { timeout: 20_000 });

	await row.getByRole('button', { name: /^Actions for/ }).click();
	await page.getByRole('menuitem', { name: 'Edit…' }).click();
	const edit = page.getByRole('dialog', { name: 'Edit recording' });
	await edit.getByRole('button', { name: 'Change setting…' }).click();
	const settings = picker(page);
	await expect(settings).toHaveAccessibleName('Choose a setting');
	await expect(edit).toBeHidden();
	await expect(settings.getByRole('button', { name: /^Setting 2,/ })).toHaveAttribute(
		'aria-current',
		'true'
	);
	const third = settings.getByRole('button', { name: 'Preview setting 3' });
	await third.click();
	await expect(player(page)).toHaveAttribute('data-playing', 'false');
	await expect(third).toHaveAttribute('data-state', 'playing', { timeout: 20_000 });
	await expect.poll(() => sounding(page)).toBe(1);

	// Escape goes back to the Edit dialog, which is still open, and stops the preview.
	await page.keyboard.press('Escape');
	await expect(settings).toBeHidden();
	await expect(edit).toBeVisible();
	await expect(edit.getByRole('button', { name: 'Change setting…' })).toBeFocused();
	await expect.poll(() => sounding(page)).toBe(0);
	await expect(edit.getByTestId('linked-tune')).toHaveText("Cooley's, setting 2");

	// Cancel does too; choosing one changes it.
	await edit.getByRole('button', { name: 'Change setting…' }).click();
	await settings.getByRole('button', { name: 'Cancel' }).click();
	await expect(edit.getByTestId('linked-tune')).toHaveText("Cooley's, setting 2");
	await edit.getByRole('button', { name: 'Change setting…' }).click();
	await settings.getByRole('button', { name: /^Setting 3, E min:/ }).click();
	await expect(settings).toBeHidden();
	await expect(edit.getByTestId('linked-tune')).toHaveText("Cooley's, setting 3");

	// Change tune: the tune picker, starting from the piece's title.
	await edit.getByRole('button', { name: 'Change tune…' }).click();
	const tunes = picker(page);
	await expect(tunes).toHaveAccessibleName('Find a tune on thesession.org');
	await expect(tunes.getByLabel('Tune name')).toHaveValue("Cooley's");
	await tunes.getByRole('button', { name: 'Close' }).click();
	await expect(edit).toBeVisible();
	await expect(edit.getByRole('button', { name: 'Change tune…' })).toBeFocused();
	await expect(edit.getByTestId('linked-tune')).toHaveText("Cooley's, setting 3");
});
