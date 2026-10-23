// Synthesized playback of thesession settings (PLAN.md §6.6, §14 "Synthesized playback"): real
// abcjs rendering in the browser, with the self-hosted soundfont, through the mini-player, the
// trim editor, Shuffle, and offline.

import { expect, test, type Page, type Route, type TestInfo } from '@playwright/test';
import { RELAY, backToList, card, open } from './helpers';
import { wav } from './media';
import { addCooleys, mockTheSession } from './thesession';

test.beforeEach(async ({ page }) => {
	await page.routeWebSocket(RELAY, (ws) => ws.close());
	await mockTheSession(page);
	await open(page);
});

const player = (page: Page) => page.getByTestId('player');
const clip = (page: Page, name: string | RegExp) => page.getByRole('listitem', { name });
const time = async (page: Page) => Number(await player(page).getAttribute('data-time'));
const end = async (page: Page) => Number(await player(page).getAttribute('data-end'));

/** Optional screenshots for review: SHOTS=<dir> npm run test:e2e -- synth */
async function shot(page: Page, info: TestInfo, name: string) {
	const dir = process.env.SHOTS;
	if (dir) await page.screenshot({ path: `${dir}/${info.project.name}-${name}.png` });
}

/**
 * Cooley's, setting 1 (E dorian): two 8-bar parts, each repeated, a crotchet pickup and a
 * shortened last bar, so 32 whole notes per time through. At the reel default (minim = 100,
 * 1.2 s a whole note) and 2× through that's 76.8 s, plus the last note's 20 ms release.
 */
const COOLEYS_SECONDS = 76.8;

/** Adds Cooley's with setting 1 and leaves its detail view open. */
async function addCooleysSetting(page: Page, info: TestInfo) {
	const dialog = await addCooleys(page, info, "Cooley's");
	await dialog.getByRole('button', { name: /^Setting 1, E dor:/ }).click();
	await dialog.getByRole('button', { name: 'Done' }).click();
	await expect(dialog).toBeHidden();
	await expect(page.getByRole('heading', { level: 1, name: "Cooley's" })).toBeVisible();
}

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

/**
 * The 100% rendering in the audio cache (the one whose key matches `pattern`, if given), decoded:
 * its peak level, the longest stretch with nothing audible (a missing sample would leave a gap),
 * how far the level dips between notes, where the off-beat quavers start, and a checksum.
 */
async function renderedAudio(page: Page, pattern?: RegExp) {
	// The file can be listed before it's completely written: try again for a while.
	for (let attempt = 0; ; attempt++) {
		try {
			return await decodeRendering(page, pattern);
		} catch (e) {
			if (attempt >= 20) throw e;
			await page.waitForTimeout(250);
		}
	}
}

async function decodeRendering(page: Page, pattern?: RegExp) {
	return page.evaluate(async (source) => {
		const match = source ? new RegExp(source) : undefined;
		const root = await navigator.storage.getDirectory();
		const dir = await root.getDirectoryHandle('audio');
		let file: File | undefined;
		for await (const [name, handle] of dir as unknown as AsyncIterable<
			[string, FileSystemFileHandle]
		>) {
			const id = decodeURIComponent(name);
			if (id.startsWith('synth:') && id.endsWith('@1.00') && (!match || match.test(id))) {
				file = await handle.getFile();
			}
		}
		if (!file) throw new Error('No cached rendering');
		const context = new OfflineAudioContext(1, 1, 32000);
		const buffer = await context.decodeAudioData(await file.arrayBuffer());
		const data = buffer.getChannelData(0);
		let peak = 0;
		let quiet = 0;
		let longestQuiet = 0;
		for (let i = 0; i < data.length; i++) {
			const v = Math.abs(data[i]);
			if (v > peak) peak = v;
			quiet = v < 0.01 ? quiet + 1 : 0;
			if (quiet > longestQuiet) longestQuiet = quiet;
		}
		// Notes are separate: at each beat (a crotchet, 0.3 s at 1.2 s a whole note) the level, in
		// 5 ms windows, drops well below the loudest of the quaver before. Notes that ring on past
		// their end (a long release, or an early start) leave the level flat across the line. Beats
		// rather than every quaver, since the lilt moves the off-beat quavers but never the beats.
		// Median over the tune, since a minim has no break in the middle.
		const rate = buffer.sampleRate;
		const rms = (from: number) => {
			const n = Math.round(rate * 0.005);
			const at = Math.round(from * rate);
			let sum = 0;
			for (let i = at; i < at + n; i++) sum += data[i] * data[i];
			return Math.sqrt(sum / n);
		};
		const dips: number[] = [];
		for (let line = 1.2; line < buffer.duration - 1; line += 0.3) {
			let loudest = 0;
			for (let t = line - 0.15; t < line - 0.02; t += 0.005) loudest = Math.max(loudest, rms(t));
			dips.push(Math.min(rms(line - 0.01), rms(line - 0.005), rms(line)) / loudest);
		}
		dips.sort((a, b) => a - b);
		const dipBetweenNotes = dips[dips.length >> 1];
		// Where the second quaver of each pair starts, after the first (on the beat): the quietest
		// moment between them, as the first fades out. Bar lines are 0.3 s (the pickup) + 1.2 s × n.
		const gaps: number[] = [];
		for (let beat = 0.3 + 2.4; beat < buffer.duration - 2; beat += 0.3) {
			let quietest = Infinity;
			let at = 0;
			for (let t = beat + 0.08; t < beat + 0.24; t += 0.005) {
				const level = rms(t);
				if (level < quietest) [quietest, at] = [level, t - beat];
			}
			gaps.push(at);
		}
		gaps.sort((a, b) => a - b);
		let checksum = 0;
		for (let i = 0; i < data.length; i += 7) checksum = (checksum * 31 + data[i] * 1e4) % 1e9;
		return {
			peak,
			silentSeconds: longestQuiet / rate,
			duration: buffer.duration,
			dipBetweenNotes,
			offBeat: gaps[gaps.length >> 1],
			checksum
		};
	}, pattern?.source);
}

async function speedControls(page: Page) {
	const toggle = player(page).getByRole('button', { name: /^Speed \d+%$/ });
	if (await toggle.isVisible()) await toggle.click();
	return player(page).getByRole('group', { name: 'Speed' });
}

test('a thesession setting plays synthesized, with speed, loop and trim', async ({
	page
}, info) => {
	test.setTimeout(90_000);
	await addCooleysSetting(page, info);
	const row = clip(page, 'thesession.org');
	await expect(row.getByTestId('synth-badge')).toHaveText('♪ Synth');

	await row.getByRole('button', { name: 'Play thesession.org' }).click();
	const bar = player(page);
	await expect(bar).toHaveAttribute('data-kind', 'synth');
	await expect(bar).toHaveAttribute('data-playing', 'true', { timeout: 20_000 });
	await expect(bar.getByTestId('synth-badge')).toBeVisible();
	await expect(bar.getByRole('link', { name: /Cooley's · E dor/ })).toBeVisible();
	await expect.poll(() => time(page)).toBeGreaterThan(0.5);
	// Twice through at the reel's default tempo.
	expect(await end(page)).toBeGreaterThan(COOLEYS_SECONDS - 0.5);
	expect(await end(page)).toBeLessThan(COOLEYS_SECONDS + 1);
	await expect(bar).toHaveAttribute('data-rendered-tempo', '1');
	await shot(page, info, 'synth-playing');
	// The rendering (cached in OPFS) is a real tune: loud enough, with notes throughout.
	const audio = await renderedAudio(page);
	expect(audio.peak).toBeGreaterThan(0.5);
	expect(audio.silentSeconds).toBeLessThan(2);
	// …and its notes end when they're written to, rather than blurring into the next ones.
	expect(audio.dipBetweenNotes).toBeLessThan(0.1);

	// Speed: re-rendered at the new tempo, in the same place in the tune, same length in tune time.
	await bar.getByRole('slider', { name: 'Position' }).fill('20');
	const speed = await speedControls(page);
	await speed.getByRole('button', { name: '75% speed' }).click();
	await expect(bar).toHaveAttribute('data-rate', '0.75');
	await expect(bar).toHaveAttribute('data-rendered-tempo', '0.75', { timeout: 15_000 });
	await expect(bar).toHaveAttribute('data-playing', 'true');
	const after = await time(page);
	expect(after).toBeGreaterThan(19.5);
	expect(after).toBeLessThan(24);
	expect(await end(page)).toBeGreaterThan(COOLEYS_SECONDS - 0.5);
	expect(await end(page)).toBeLessThan(COOLEYS_SECONDS + 1);
	// Tune time runs at 75%: about 0.75 s per second.
	const t0 = await time(page);
	await page.waitForTimeout(2000);
	const ran = (await time(page)) - t0;
	expect(ran).toBeGreaterThan(1.1);
	expect(ran).toBeLessThan(1.9);

	// Loop: near the end it jumps back to the start and keeps playing.
	await bar.getByRole('button', { name: 'Loop' }).click();
	await bar.getByRole('slider', { name: 'Position' }).fill(String(COOLEYS_SECONDS - 0.6));
	await expect.poll(() => time(page), { timeout: 5000 }).toBeLessThan(3);
	await expect(bar).toHaveAttribute('data-playing', 'true');
	await bar.getByRole('button', { name: 'Loop' }).click();
	await bar.getByRole('button', { name: 'Pause' }).click();

	// Trim the B part's first time through, in the trim editor, on the 100% waveform.
	await row.getByRole('button', { name: /^Actions for/ }).click();
	await page.getByRole('menuitem', { name: 'Trim…' }).click();
	const dialog = page.getByRole('dialog', { name: /Trim/ });
	await expect(dialog.getByText('Drawing the waveform…')).toBeHidden({ timeout: 15_000 });
	await expect(dialog.locator('canvas')).toBeVisible();
	await expect(dialog.getByText('of 1:16')).toBeVisible();
	await dialog.getByRole('button', { name: 'Play', exact: true }).click();
	await expect(bar).toHaveAttribute('data-playing', 'true');
	await dialog.getByRole('button', { name: 'Pause' }).click();
	const start = dialog.getByLabel('Start', { exact: true });
	const stop = dialog.getByLabel('End', { exact: true });
	await start.fill('19.2');
	await start.press('Tab');
	await stop.fill('22.8');
	await stop.press('Tab');
	await dialog.getByRole('button', { name: 'Preview (loop)' }).click();
	await expect(bar).toHaveAttribute('data-playing', 'true');
	await shot(page, info, 'synth-trim');
	await dialog.getByRole('button', { name: 'Save trim' }).click();
	await expect(dialog).toBeHidden();
	await expect(row.getByTestId('clip-trim')).toHaveText('0:19–0:22');

	// Playback keeps to the trim (in tune time, whatever the speed), and stops at its end.
	await row.getByRole('button', { name: 'Play thesession.org' }).click();
	await expect(bar).toHaveAttribute('data-start', '19.20');
	await expect(bar).toHaveAttribute('data-end', '22.80');
	await expect(bar).toHaveAttribute('data-playing', 'true');
	await expect(bar).toHaveAttribute('data-playing', 'false', { timeout: 10_000 });
	const stopped = await time(page);
	expect(stopped).toBeGreaterThan(22.5);
	expect(stopped).toBeLessThan(23.1);
});

test('instrument, times through and notation', async ({ page }, info) => {
	test.setTimeout(90_000);
	await addCooleysSetting(page, info);
	const row = clip(page, 'thesession.org');
	await row.getByRole('button', { name: 'Play thesession.org' }).click();
	const bar = player(page);
	await expect(bar).toHaveAttribute('data-playing', 'true', { timeout: 20_000 });
	await bar.getByRole('button', { name: 'Pause' }).click();

	await row.getByRole('button', { name: /^Actions for/ }).click();
	await page.getByRole('menuitem', { name: 'Edit…' }).click();
	const edit = page.getByRole('dialog', { name: 'Edit recording' });
	const options = edit.getByRole('group', { name: 'Synthesized playback' });
	await expect(options.getByLabel('Instrument')).toHaveValue('fiddle');
	await expect(options.getByLabel('Times through')).toHaveValue('2');

	// One time through: the loaded tune is re-rendered in place, half as long.
	await options.getByLabel('Times through').selectOption('1');
	await expect.poll(() => end(page), { timeout: 15_000 }).toBeLessThan(COOLEYS_SECONDS / 2 + 1);
	expect(await end(page)).toBeGreaterThan(COOLEYS_SECONDS / 2 - 0.5);
	// Another instrument, with chords on, renders too.
	await options.getByLabel('Instrument').selectOption('whistle');
	await options.getByLabel('Chord accompaniment').check();

	// Notation, with the playing note highlighted.
	await edit.getByRole('button', { name: 'Show notation' }).click();
	const notation = edit.getByTestId('notation');
	await expect(notation.locator('svg')).toBeVisible({ timeout: 15_000 });
	await expect(notation.getByText('Drawing the notation…')).toBeHidden();
	await expect(notation.locator('.abcjs-note').first()).toBeVisible();
	await shot(page, info, 'synth-notation');
	await edit.getByRole('button', { name: 'Done' }).click();
	await expect(edit).toBeHidden();
	await expect(bar).toHaveAttribute('data-playing', 'false');

	// The options are this device's, kept across reloads.
	await page.goto('/settings');
	const settings = page.getByRole('group', { name: 'Synthesized playback' });
	await expect(settings.getByLabel('Instrument')).toHaveValue('whistle');
	await expect(settings.getByLabel('Times through')).toHaveValue('1');
	await expect(settings.getByLabel('Chord accompaniment')).toBeChecked();
});

test('Shuffle plays a synthesized setting', async ({ page }, info) => {
	test.setTimeout(60_000);
	await addCooleysSetting(page, info);
	await backToList(page, info);
	await page.getByRole('link', { name: 'Shuffle', exact: true }).click();
	await expect(page.getByRole('heading', { level: 1, name: 'Shuffle' })).toBeVisible();

	const bar = page.getByTestId('shuffle-player');
	await expect(bar.getByTestId('synth-badge')).toBeVisible();
	await bar.getByRole('button', { name: 'Play' }).click();
	await expect(bar).toHaveAttribute('data-kind', 'synth');
	await expect(bar).toHaveAttribute('data-playing', 'true', { timeout: 20_000 });
	const t = async () => Number(await bar.getAttribute('data-time'));
	await expect.poll(t).toBeGreaterThan(0.5);
	await bar
		.getByRole('group', { name: 'Speed' })
		.getByRole('button', { name: '60% speed' })
		.click();
	await expect(bar).toHaveAttribute('data-rendered-tempo', '0.6', { timeout: 15_000 });
	await expect(bar).toHaveAttribute('data-playing', 'true');
	await shot(page, info, 'synth-shuffle');
});

test('Shuffle comes up on a real recording before the synthesized setting', async ({
	page
}, info) => {
	await addCooleysSetting(page, info);
	// A synthesized setting isn't a real recording: the import panel stays prominent.
	await expect(page.getByRole('group', { name: 'Add a recording' })).toBeVisible();
	await page
		.getByLabel('Upload a file')
		.setInputFiles({ name: 'cooleys-live.wav', mimeType: 'audio/wav', buffer: wav(6) });
	await expect(clip(page, 'cooleys-live')).toBeVisible();
	await backToList(page, info);
	await page.getByRole('link', { name: 'Shuffle', exact: true }).click();

	const bar = page.getByTestId('shuffle-player');
	const picker = bar.getByLabel('Recording');
	await expect(picker.locator('option:checked')).toHaveText('cooleys-live');
	await picker.selectOption({ label: '♪ thesession.org (synth)' });
	await expect(bar.getByTestId('synth-badge')).toHaveCount(0);
	await bar.getByRole('button', { name: 'Play' }).click();
	await expect(bar).toHaveAttribute('data-kind', 'synth');
	await expect(bar).toHaveAttribute('data-playing', 'true', { timeout: 20_000 });
});

test('plays offline after the first time', async ({ page, context }, info) => {
	test.setTimeout(90_000);
	// Let the service worker take over first, so it caches the soundfont samples as they load.
	await page.evaluate(() => navigator.serviceWorker.ready);
	await page.reload();
	await expect(page.getByText(/\d+ pieces?|No tunes yet/).first()).toBeVisible();
	// The samples go through the service worker (which is what caches them).
	const samples: string[] = [];
	await context.route(/\/soundfont\//, (route) => {
		samples.push(route.request().url());
		return route.fallback();
	});
	await addCooleysSetting(page, info);
	const row = clip(page, 'thesession.org');
	await row.getByRole('button', { name: 'Play thesession.org' }).click();
	const bar = player(page);
	await expect(bar).toHaveAttribute('data-playing', 'true', { timeout: 20_000 });
	await bar.getByRole('button', { name: 'Pause' }).click();
	expect(samples.some((url) => url.includes('/violin-mp3/'))).toBe(true);

	await context.setOffline(true);
	// Context routes still answer offline: cut thesession.org and the samples off for real, so only
	// the caches (tune data, the service worker's samples, the rendering in OPFS) can serve them.
	const cut = (route: Route) => route.abort('internetdisconnected');
	await context.route('https://thesession.org/**', cut);
	await context.route(/\/soundfont\//, cut);
	await page.reload();
	await expect(page.getByRole('heading', { level: 1, name: "Cooley's" })).toBeVisible();
	// Still a synth (the tune's ABC is cached), not a link out.
	await expect(row.getByTestId('synth-badge')).toBeVisible();
	await row.getByRole('button', { name: 'Play thesession.org' }).click();
	await expect(bar).toHaveAttribute('data-playing', 'true', { timeout: 20_000 });
	await expect.poll(() => time(page)).toBeGreaterThan(0.3);
	// A new speed renders again from the cached samples.
	const speed = await speedControls(page);
	await speed.getByRole('button', { name: '90% speed' }).click();
	await expect(bar).toHaveAttribute('data-rendered-tempo', '0.9', { timeout: 15_000 });
	await expect(bar).toHaveAttribute('data-playing', 'true');
	await context.unrouteAll();
	await context.setOffline(false);
});

test('offline, a tune never loaded on this device opens thesession.org instead', async ({
	page,
	context
}, info) => {
	await addCooleysSetting(page, info);
	await backToList(page, info);
	// As on a device that never loaded the tune: nothing cached, so nothing to synthesize from.
	await page.getByRole('link', { name: 'Settings' }).click();
	await page.getByRole('button', { name: 'Clear cached data' }).click();
	await expect(page.getByTestId('cache-count')).toHaveText('Nothing cached.');
	await context.setOffline(true);
	// Context routes still answer offline, so cut thesession.org off too (a later route wins).
	const cut = (route: Route) => route.abort('internetdisconnected');
	await context.route('https://thesession.org/**', cut);
	await page.reload();
	await page.getByRole('link', { name: '← All pieces' }).click();
	await card(page, "Cooley's").getByRole('link', { name: "Cooley's" }).click();
	const row = clip(page, 'thesession.org');
	await expect(row.getByRole('link', { name: /Open thesession\.org/ })).toBeVisible();
	await expect(row.getByTestId('synth-badge')).toHaveCount(0);
	await context.unroute('https://thesession.org/**', cut);
	await context.setOffline(false);
	await page.reload();
	await expect(row.getByTestId('synth-badge')).toBeVisible();
});

test('humanization: lilt, accent and attack change the rendering', async ({ page }, info) => {
	test.setTimeout(90_000);
	await addCooleysSetting(page, info);
	const row = clip(page, 'thesession.org');
	await row.getByRole('button', { name: 'Play thesession.org' }).click();
	const bar = player(page);
	await expect(bar).toHaveAttribute('data-playing', 'true', { timeout: 20_000 });
	await bar.getByRole('button', { name: 'Pause' }).click();
	// The default feel is on: its own rendering, keyed by its settings.
	const humanized = /:h20,20,15@1\.00$/;
	await expect.poll(() => cachedRenderings(page)).toContainEqual(expect.stringMatching(humanized));

	await row.getByRole('button', { name: /^Actions for/ }).click();
	await page.getByRole('menuitem', { name: 'Edit…' }).click();
	const edit = page.getByRole('dialog', { name: 'Edit recording' });
	const options = edit.getByRole('group', { name: 'Synthesized playback' });
	await expect(options.getByLabel('Style')).toHaveValue('irish');
	await expect(options.getByLabel('Lilt')).toHaveValue('20');
	await expect(options.locator('output').first()).toHaveText('1.14:1');

	// As written: the plain rendering, with the key it had before humanization existed.
	await options.getByRole('button', { name: 'As written' }).click();
	await expect(options.getByLabel('Accent')).toHaveValue('0');
	const plainKey = /:melody@1\.00$/;
	await expect
		.poll(() => cachedRenderings(page), { timeout: 15_000 })
		.toContainEqual(expect.stringMatching(plainKey));
	const plain = await renderedAudio(page, plainKey);
	const defaults = await renderedAudio(page, humanized);
	expect(defaults.checksum).not.toBe(plain.checksum);
	// Bar lines don't move, so the tune is just as long.
	expect(defaults.duration).toBeCloseTo(plain.duration, 3);
	// Played as written, the off-beat quaver starts a quaver (0.15 s) after the beat.
	expect(plain.offBeat).toBeGreaterThan(0.13);
	expect(plain.offBeat).toBeLessThan(0.165);

	// A strong lilt: 80 makes the pairs about 1.73:1, so the off-beat starts ~40 ms later.
	await options.getByLabel('Lilt').fill('80');
	await expect(options.locator('output').first()).toHaveText('1.73:1');
	const lilted = /:h80,0,0@1\.00$/;
	await expect
		.poll(() => cachedRenderings(page), { timeout: 15_000 })
		.toContainEqual(expect.stringMatching(lilted));
	const lilt = await renderedAudio(page, lilted);
	expect(lilt.offBeat - plain.offBeat).toBeGreaterThan(0.025);
	expect(lilt.offBeat - plain.offBeat).toBeLessThan(0.06);
	expect(lilt.duration).toBeCloseTo(plain.duration, 3);
	// …and a negative one, the reverse.
	await options.getByLabel('Lilt').fill('-80');
	const reversed = /:h-80,0,0@1\.00$/;
	await expect
		.poll(() => cachedRenderings(page), { timeout: 15_000 })
		.toContainEqual(expect.stringMatching(reversed));
	expect((await renderedAudio(page, reversed)).offBeat - plain.offBeat).toBeLessThan(-0.025);

	// Old-time, with some accent: another rendering.
	await options.getByLabel('Style').selectOption('oldtime');
	await options.getByLabel('Accent').fill('50');
	await expect
		.poll(() => cachedRenderings(page), { timeout: 15_000 })
		.toContainEqual(expect.stringMatching(/:h-80,50,0o@1\.00$/));
	await shot(page, info, 'synth-humanize');
	await edit.getByRole('button', { name: 'Done' }).click();

	// This device's, kept across reloads, and in Settings too.
	await page.goto('/settings');
	const settings = page.getByRole('group', { name: 'Synthesized playback' });
	await expect(settings.getByLabel('Style')).toHaveValue('oldtime');
	await expect(settings.getByLabel('Lilt')).toHaveValue('-80');
	await expect(settings.getByLabel('Accent')).toHaveValue('50');
	await settings.getByRole('button', { name: 'Default' }).click();
	await expect(settings.getByLabel('Lilt')).toHaveValue('20');
	await expect(settings.getByLabel('Attack')).toHaveValue('15');
	await expect(settings.getByLabel('Style')).toHaveValue('oldtime');
});
