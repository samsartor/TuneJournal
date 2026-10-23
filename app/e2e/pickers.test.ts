// The thesession.org tune and setting pickers (PLAN.md §6.3): views of their own that cover the
// edit modal or a recording's Edit dialog, with previews synthesized by the real abcjs renderer.

import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { RELAY, isMobile, open } from './helpers';
import { addCooleys, fixture, mockTheSession, picker, searchTheSession } from './thesession';

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

	// The preview speed re-renders at that tempo. On a phone it's folded behind its value.
	if (isMobile(info)) await settings.getByRole('button', { name: 'Preview speed 100%' }).click();
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

	// The preview bar shows it too, and pauses and seeks it.
	const bar = picker(page).getByTestId('preview-bar');
	await expect(bar).toContainText("Cooley's");
	await bar.getByRole('button', { name: 'Pause preview' }).click();
	await expect(play).toHaveAttribute('data-state', 'paused');
	await expect.poll(() => sounding(page)).toBe(0);
	await bar.getByRole('slider', { name: 'Preview position' }).fill('30');
	await expect(bar).toHaveAttribute('data-time', /^(29\.9|30\.)/);
	await expectNoSideScroll(page, picker(page));
	// ▶ on the row carries on from there.
	await play.click();
	await expect(play).toHaveAttribute('data-state', 'playing');
	await expect.poll(async () => Number(await bar.getAttribute('data-time'))).toBeGreaterThan(30);

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

test('the preview bar seeks a setting, and its notation follows the bars playing', async ({
	page
}, info) => {
	test.setTimeout(90_000);
	await addCooleys(page, info, "Cooley's");
	const settings = picker(page);
	const rows = settings.getByRole('list').getByRole('listitem');
	const incipit = rows.nth(0).getByTestId('incipit');
	await expect(incipit).toHaveAttribute('data-drawn', 'true', { timeout: 15_000 });
	await expect(incipit).toHaveAttribute('data-following', 'false');
	const height = (await incipit.boundingBox())!.height;
	const bar = settings.getByTestId('preview-bar');
	await expect(bar).toBeHidden();

	// Playing: the bar shows, and the notation shows the bars playing, from the pickup and first two.
	const first = settings.getByRole('button', { name: 'Preview setting 1' });
	await first.click();
	await expect(first).toHaveAttribute('data-state', 'playing', { timeout: 20_000 });
	await expect(bar).toBeVisible();
	await expect(bar).toContainText('Setting 1');
	await expect(incipit).toHaveAttribute('data-following', 'true');
	await expect(incipit).toHaveAttribute('data-measures', '1,2,3');
	await expect(incipit.locator('.abcjs-current').first()).toBeAttached();
	await expectNoSideScroll(page, settings);
	await shot(page, info, 'preview-bar');
	// It moves on as it plays (a reel's two bars take 2.4 s at 100%).
	await expect(incipit).toHaveAttribute('data-measures', '4,5', { timeout: 10_000 });

	// Paused, a seek moves the notation at once: 20 s in is the B part's first time through.
	await bar.getByRole('button', { name: 'Pause preview' }).click();
	await expect(bar).toHaveAttribute('data-playing', 'false');
	await expect(first).toHaveAttribute('data-state', 'paused');
	const position = bar.getByRole('slider', { name: 'Preview position' });
	await position.fill('20');
	await expect(bar).toHaveAttribute('data-time', '20.00');
	await expect(incipit).toHaveAttribute('data-window', '8');
	await expect(incipit).toHaveAttribute('data-measures', '12,13');
	await expect(incipit.locator('.abcjs-current').first()).toBeAttached();
	// The keyboard seeks too.
	await position.focus();
	await page.keyboard.press('End');
	await expect.poll(async () => Number(await bar.getAttribute('data-time'))).toBeGreaterThan(70);
	await expect(incipit).not.toHaveAttribute('data-measures', '12,13');
	await position.fill('20');
	await expect(incipit).toHaveAttribute('data-measures', '12,13');
	// The row keeps its height whatever bars it shows.
	expect(Math.abs((await incipit.boundingBox())!.height - height)).toBeLessThan(1);

	// At another speed the place in the tune holds, and seeking still maps to the same bars.
	if (isMobile(info)) await settings.getByRole('button', { name: 'Preview speed 100%' }).click();
	await settings
		.getByRole('group', { name: 'Preview speed' })
		.getByRole('button', { name: '50% speed' })
		.click();
	await bar.getByRole('button', { name: 'Play preview' }).click();
	await expect(bar).toHaveAttribute('data-playing', 'true');
	await page.waitForTimeout(1000);
	await expect(incipit).toHaveAttribute('data-measures', '12,13');
	await bar.getByRole('button', { name: 'Pause preview' }).click();
	await position.fill('32');
	await expect(incipit).toHaveAttribute('data-measures', '14,15');
	await expectNoSideScroll(page, settings);
	await shot(page, info, 'preview-bar-seeked');

	// Stopping goes back to the opening bars.
	await bar.getByRole('button', { name: 'Stop preview' }).click();
	await expect(bar).toBeHidden();
	await expect(first).toHaveAttribute('data-state', 'idle');
	await expect(incipit).toHaveAttribute('data-following', 'false');
	await expect(incipit.locator('.score')).toBeVisible();

	// So does leaving the settings while it plays: back to the results, then the same tune again.
	await first.click();
	await expect(incipit).toHaveAttribute('data-following', 'true', { timeout: 20_000 });
	await settings.getByRole('button', { name: 'Back to search results' }).click();
	await expect.poll(() => sounding(page)).toBe(0);
	await settings
		.getByRole('list', { name: 'thesession.org results' })
		.getByRole('button', { name: /^Cooley's\s+Reel/ })
		.click();
	await expect(settings).toHaveAccessibleName('Choose a setting');
	await expect(incipit).toHaveAttribute('data-drawn', 'true', { timeout: 15_000 });
	await expect(incipit).toHaveAttribute('data-following', 'false');
	await expect(bar).toBeHidden();

	// And closing the picker stops it.
	await first.click();
	await expect(incipit).toHaveAttribute('data-following', 'true', { timeout: 20_000 });
	await settings.getByRole('button', { name: 'Close' }).click();
	await expect(settings).toBeHidden();
	await expect.poll(() => sounding(page)).toBe(0);
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

/** The synth renderings in the audio cache (OPFS), by cache key. */
async function cachedRenderings(page: Page): Promise<string[]> {
	return page.evaluate(async () => {
		const root = await navigator.storage.getDirectory();
		const dir = await root.getDirectoryHandle('audio', { create: true });
		const names: string[] = [];
		for await (const [name] of dir as unknown as AsyncIterable<[string, unknown]>) {
			const id = decodeURIComponent(name);
			if (id.startsWith('synth:')) names.push(id);
		}
		return names;
	});
}

/** Seamus Cooley's, a jig (not in the recorded fixtures): Cooley's data with one jig setting. */
function seamusCooleys(): string {
	const tune = JSON.parse(fixture('tune-1.json'));
	return JSON.stringify({
		...tune,
		id: 414,
		name: "Seamus Cooley's",
		url: 'https://thesession.org/tunes/414',
		type: 'jig',
		settings: [
			{
				...tune.settings[0],
				id: 41400,
				url: 'https://thesession.org/tunes/414#setting41400',
				key: 'Gmajor',
				abc: '|:D|GAG GAB|ABA ABd|edd gdd|edB dBA|GAG GAB|ABA ABd|edd gdB|AGF G2:|'
			}
		]
	});
}

test('previews play with the profile of the tune’s type tag, unless the piece’s own tags match first', async ({
	page
}, info) => {
	test.setTimeout(90_000);
	await mockTheSession(page, { '/tunes/414': seamusCooleys() });
	await openAdd(page, info);
	const results = await searchTheSession(page, 'cooley');

	// A reel: the Reel profile (lilt even, accent +30, attack +10).
	const reel = results.getByRole('button', { name: "Preview Cooley's" }).first();
	await reel.click();
	await expect(reel).toHaveAttribute('data-state', 'playing', { timeout: 20_000 });
	await expect
		.poll(() => cachedRenderings(page))
		.toContainEqual(expect.stringMatching(/:s1:.*:melody:hr1,30,10@1\.00$/));
	// A jig: the Jig profile (lilt 1.1).
	const jig = results.getByRole('button', { name: "Preview Seamus Cooley's" });
	await jig.click();
	await expect(jig).toHaveAttribute('data-state', 'playing', { timeout: 20_000 });
	await expect
		.poll(() => cachedRenderings(page))
		.toContainEqual(expect.stringMatching(/:s41400:.*:melody:hr1\.1,30,10@1\.00$/));
	await picker(page).getByRole('button', { name: 'Close' }).click();

	// Tagged "Old Time" first: Old Time comes before Reel in the profiles, so it wins.
	const edit = page.getByRole('dialog', { name: 'New tune' });
	const tags = edit.getByRole('combobox', { name: 'Tags' });
	await tags.fill('Old Time');
	await tags.press('Enter');
	const again = await searchTheSession(page, 'cooley');
	const oldTime = again.getByRole('button', { name: "Preview Cooley's" }).first();
	await oldTime.click();
	await expect(oldTime).toHaveAttribute('data-state', 'playing', { timeout: 20_000 });
	await expect
		.poll(() => cachedRenderings(page))
		.toContainEqual(expect.stringMatching(/:s1:.*:melody:hr1\.5,-20,0@1\.00$/));
});
