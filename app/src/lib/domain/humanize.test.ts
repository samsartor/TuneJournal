import { describe, expect, it } from 'vitest';
import {
	ATTACK_SECONDS,
	HUMANIZE_DEFAULTS,
	HUMANIZE_OFF,
	beatGroups,
	humanizeKey,
	humanizeNotes,
	isHumanizeOff,
	liltRatio,
	liltWarp,
	meterGrid,
	normalizeHumanize,
	shapeAttack,
	stressAt,
	type Grid,
	type Humanize,
	type NoteEvent
} from './humanize';

const E = 1 / 8;
const grid = (num: number, den: number) => meterGrid({ num, den }) as Grid;
/** Evenly spaced bar lines: `bars` bars of `length`, after a pickup of `pickup`. */
const bars = (bars: number, length: number, pickup = 0) => {
	const starts = pickup ? [0] : [];
	for (let i = 0; i < bars; i++) starts.push(pickup + i * length);
	return { starts, total: pickup + bars * length };
};
/** Stress of each quaver from `from` for `count` quavers, as a string: s(trong), w(eak), o(ff). */
const pattern = (
	g: Grid,
	starts: number[],
	total: number,
	from: number,
	count: number,
	style: 'irish' | 'oldtime' = 'irish',
	copies = 1
) => {
	const groups = beatGroups(starts, total, g, copies);
	return Array.from({ length: count }, (_, i) => stressAt(groups, g, style, from + i * E)[0]).join(
		''
	);
};

describe('beat grid', () => {
	it('groups quavers in twos in simple meters and threes in compound ones', () => {
		for (const [num, den] of [
			[4, 4],
			[2, 2],
			[2, 4],
			[3, 4],
			[3, 2]
		])
			expect(meterGrid({ num, den })).toEqual({ unit: E, group: 2, measure: num / den });
		for (const num of [6, 9, 12, 3])
			expect(meterGrid({ num, den: 8 })).toEqual({ unit: E, group: 3, measure: num / 8 });
	});

	it('leaves meters it doesn’t know alone', () => {
		expect(meterGrid({ num: 7, den: 8 })).toBeUndefined();
		expect(meterGrid({ num: 5, den: 8 })).toBeUndefined();
		expect(meterGrid({ num: 4, den: 16 })).toBeUndefined();
		expect(meterGrid({ num: 0, den: 4 })).toBeUndefined();
		expect(meterGrid(undefined)).toBeUndefined();
		expect(meterGrid({ num: 4 })).toBeUndefined();
	});

	it('stresses quavers 1, 3, 5, 7 of a reel bar (4/4 and 2/2) and 1, 3 in 2/4', () => {
		const { starts, total } = bars(2, 1);
		expect(pattern(grid(4, 4), starts, total, 0, 16)).toBe('swswswswswswswsw');
		expect(pattern(grid(2, 2), starts, total, 0, 8)).toBe('swswswsw');
		const polka = bars(2, 0.5);
		expect(pattern(grid(2, 4), polka.starts, polka.total, 0, 8)).toBe('swswswsw');
	});

	it('stresses quavers 1, 4, 7, 10 in 6/8, 9/8 and 12/8', () => {
		const jig = bars(2, 6 / 8);
		expect(pattern(grid(6, 8), jig.starts, jig.total, 0, 12)).toBe('swwswwswwsww');
		const slip = bars(1, 9 / 8);
		expect(pattern(grid(9, 8), slip.starts, slip.total, 0, 9)).toBe('swwswwsww');
		const slide = bars(1, 12 / 8);
		expect(pattern(grid(12, 8), slide.starts, slide.total, 0, 12)).toBe('swwswwswwsww');
	});

	it('puts old-time accents on the last quaver of each group', () => {
		const { starts, total } = bars(1, 1);
		expect(pattern(grid(4, 4), starts, total, 0, 8, 'oldtime')).toBe('wswswsws');
		const jig = bars(1, 6 / 8);
		expect(pattern(grid(6, 8), jig.starts, jig.total, 0, 6, 'oldtime')).toBe('wwswws');
	});

	it('counts a pickup back from the bar line', () => {
		// One quaver pickup in a reel: the 8th quaver of a bar, weak. Then the bar starts strong.
		const reel = bars(2, 1, E);
		expect(pattern(grid(4, 4), reel.starts, reel.total, 0, 5)).toBe('wswsw');
		// Two quavers in a jig ("AB|"): quavers 5 and 6 of a bar.
		const jig = bars(2, 6 / 8, 2 * E);
		expect(pattern(grid(6, 8), jig.starts, jig.total, 0, 5)).toBe('wwsww');
		// A crotchet pickup in a reel ("D2|"): quaver 7, strong.
		const crotchet = bars(2, 1, 2 * E);
		expect(pattern(grid(4, 4), crotchet.starts, crotchet.total, 0, 4)).toBe('swsw');
	});

	it('finds the pickup again at each time through, and inside a repeat', () => {
		// Jig, one-quaver pickup, a full last bar: twice through, each starting "A|".
		const once = [0, E, E + 6 / 8];
		const total1 = E + 12 / 8;
		const starts = [...once, total1, ...once.slice(1).map((t) => t + total1)];
		const total = 2 * total1;
		expect(pattern(grid(6, 8), starts, total, total1, 4, 'irish', 2)).toBe('wsww');
		// Without knowing the times through, the second pickup counts as a short bar: from its start.
		expect(pattern(grid(6, 8), starts, total, total1, 4, 'irish', 1)).toBe('ssww');
		// A shortened last bar of a part (5 quavers), then its pickup repeated (1): one bar between them.
		const split = [0, E, E + 6 / 8, E + 6 / 8 + 5 * E, E + 12 / 8];
		const splitTotal = E + 12 / 8 + 6 / 8;
		expect(pattern(grid(6, 8), split, splitTotal, E + 6 / 8, 7)).toBe('swwswws');
	});

	it('counts other short and long bars from their start', () => {
		// A 2/4 bar in a reel, then 4/4 again.
		const starts = [0, 0.5, 1.5];
		expect(pattern(grid(4, 4), starts, 2.5, 0, 12)).toBe('swswswswswsw');
		// A 7-quaver bar in a jig: its last quaver starts a group of its own.
		expect(pattern(grid(6, 8), [0, 7 * E], 13 * E, 0, 8)).toBe('swwswwss');
	});
});

describe('lilt', () => {
	const g = grid(4, 4);
	const { starts, total } = bars(4, 1);
	const groups = beatGroups(starts, total, g);

	it('keeps group boundaries and bar lines where they are', () => {
		const warp = liltWarp(groups, g, 60);
		for (let t = 0; t <= total; t += 2 * E) expect(warp(t)).toBeCloseTo(t, 9);
		const jig = grid(6, 8);
		const jigBars = bars(2, 6 / 8, E);
		const jigWarp = liltWarp(beatGroups(jigBars.starts, jigBars.total, jig), jig, -80);
		for (let t = E; t <= jigBars.total; t += 3 * E) expect(jigWarp(t)).toBeCloseTo(t, 9);
	});

	it('lengthens the strong quaver and shortens the rest, monotonically', () => {
		const warp = liltWarp(groups, g, 100);
		// 2:1 at 100.
		expect(warp(E)).toBeCloseTo((4 / 3) * E, 9);
		expect(liltRatio(100)).toBe('2.00:1');
		expect(liltRatio(HUMANIZE_DEFAULTS.lilt)).toBe('1.14:1');
		let last = -1;
		for (let t = 0; t <= total; t += 1 / 96) {
			const w = warp(t);
			expect(w).toBeGreaterThanOrEqual(last);
			last = w;
		}
	});

	it('reverses with a negative lilt', () => {
		const warp = liltWarp(groups, g, -100);
		expect(warp(E)).toBeCloseTo((2 / 3) * E, 9);
		expect(liltRatio(-100)).toBe('1:2.00');
		expect(warp(1 + E)).toBeLessThan(1 + E);
	});

	it('scales triplets and notes between grid lines consistently', () => {
		const warp = liltWarp(groups, g, 50);
		// A triplet of quavers over a crotchet: still in order, still ending on the next group.
		const triplet = [0, 1 / 12, 2 / 12, 3 / 12].map(warp);
		expect(triplet[3]).toBeCloseTo(0.25, 9);
		expect(triplet[1]).toBeGreaterThan(1 / 12);
		expect(triplet[2]).toBeGreaterThan(triplet[1]);
	});

	it('leaves a pickup’s partial group alone', () => {
		const jig = grid(6, 8);
		const b = bars(2, 6 / 8, 2 * E);
		const warp = liltWarp(beatGroups(b.starts, b.total, jig), jig, 100);
		expect(warp(E)).toBe(E);
		expect(warp(2 * E + E)).toBeGreaterThan(3 * E);
	});
});

const settings = (h: Partial<Humanize>): Humanize => ({ ...HUMANIZE_OFF, ...h });
/** A bar of reel quavers at velocity 90, after a crotchet pickup and a grace note. */
function reelTrack(): NoteEvent[] {
	const notes: NoteEvent[] = [
		{ cmd: 'program' },
		{ cmd: 'note', start: 0, duration: 0.25, volume: 90 }
	];
	for (let i = 0; i < 8; i++)
		notes.push({ cmd: 'note', start: 0.25 + i * E, duration: E, volume: 90 });
	notes.push({ cmd: 'note', start: 0.5, duration: 1 / 32, volume: 60, style: 'grace' });
	return notes;
}
const input = (tracks: NoteEvent[][], h: Partial<Humanize>, num = 4, den = 4) => ({
	tracks,
	meter: { num, den },
	barStarts: [0, 0.25],
	total: 1.25,
	copies: 1,
	settings: settings(h)
});

describe('humanizing notes', () => {
	it('changes nothing when off, or for a meter it doesn’t know', () => {
		const tracks = [reelTrack()];
		expect(humanizeNotes(input(tracks, HUMANIZE_OFF))).toEqual([]);
		expect(tracks).toEqual([reelTrack()]);
		expect(humanizeNotes(input(tracks, { lilt: 50, accent: 50, attack: 50 }, 7, 8))).toEqual([]);
		expect(tracks).toEqual([reelTrack()]);
	});

	it('scales velocities up on strong quavers and down on the rest, keeping the level', () => {
		const tracks = [reelTrack()];
		humanizeNotes(input(tracks, { accent: 40 }));
		const v = tracks[0].filter((n) => n.cmd === 'note' && !n.style).map((n) => n.volume);
		expect(v).toEqual([108, 108, 72, 108, 72, 108, 72, 108, 72]);
		// Grace notes are left alone.
		expect(tracks[0].at(-1)?.volume).toBe(60);
		// Negative: the reverse.
		const neg = [reelTrack()];
		humanizeNotes(input(neg, { accent: -40 }));
		expect(neg[0][2].volume).toBe(72);
		expect(neg[0][3].volume).toBe(108);
		// Old-time: on the off-beat quavers.
		const old = [reelTrack()];
		humanizeNotes(input(old, { accent: 40, style: 'oldtime' }));
		expect(old[0][2].volume).toBe(72);
		expect(old[0][3].volume).toBe(108);
		// In a jig, two weak quavers for each strong one.
		const jig: NoteEvent[][] = [
			[0, 1, 2].map((i) => ({ cmd: 'note', start: i * E, duration: E, volume: 90 }))
		];
		humanizeNotes({ ...input(jig, { accent: 40 }, 6, 8), barStarts: [0], total: 6 / 8 });
		expect(jig[0].map((n) => n.volume)).toEqual([108, 81, 81]);
	});

	it('clamps velocities to 1–127', () => {
		const tracks: NoteEvent[][] = [
			[
				{ cmd: 'note', start: 0.25, duration: E, volume: 120 },
				{ cmd: 'note', start: 0.375, duration: E, volume: 1 }
			]
		];
		humanizeNotes(input(tracks, { accent: 100 }));
		expect(tracks[0].map((n) => n.volume)).toEqual([127, 1]);
	});

	it('moves and resizes notes with the lilt, across every track', () => {
		const melody = reelTrack();
		const bass: NoteEvent[] = [
			{ cmd: 'note', start: 0.25, duration: 0.25, volume: 70 },
			{ cmd: 'note', start: 0.375, duration: E, volume: 70 }
		];
		humanizeNotes(input([melody, bass], { lilt: 100 }));
		// Strong quaver: same start, 4/3 as long; the weak one after it starts later, 2/3 as long.
		expect(melody[2]).toMatchObject({ start: 0.25 });
		expect(melody[2].duration).toBeCloseTo(E * (4 / 3), 5);
		expect(melody[3].start).toBeCloseTo(0.25 + E * (4 / 3), 5);
		expect(melody[3].duration).toBeCloseTo(E * (2 / 3), 5);
		// Crotchets on the beat don't change; the bass's off-beat quaver moves with the melody's.
		expect(bass[0]).toMatchObject({ start: 0.25, duration: 0.25 });
		expect(bass[1].start).toBeCloseTo(melody[3].start as number, 9);
		// The pickup crotchet is a whole group: unchanged.
		expect(melody[1]).toMatchObject({ start: 0, duration: 0.25 });
	});

	it('returns the strong onsets, after the lilt, for the attack', () => {
		const tracks = [reelTrack()];
		expect(humanizeNotes(input(tracks, { lilt: 50, accent: 0 }))).toEqual([]);
		const onsets = humanizeNotes(input([reelTrack()], { lilt: 50, attack: 30 }));
		expect(onsets).toEqual([0, 0.25, 0.5, 0.75, 1]);
		const old = humanizeNotes(input([reelTrack()], { lilt: 100, attack: 30, style: 'oldtime' }));
		expect(old[0]).toBeCloseTo(0.25 + E * (4 / 3), 5);
		expect(old).toHaveLength(4);
	});
});

describe('attack', () => {
	const rate = 1000;
	const window = ATTACK_SECONDS * rate;
	const ones = () => new Float32Array(400).fill(1);

	it('boosts the start of strong notes and eases back', () => {
		const samples = ones();
		shapeAttack(samples, rate, [0.1, 0.3], 100);
		expect(samples[99]).toBe(1);
		expect(samples[100]).toBeCloseTo(3, 5);
		expect(samples[100 + window / 2]).toBeGreaterThan(1);
		expect(samples[100 + window / 2]).toBeLessThan(samples[100]);
		expect(samples[100 + window]).toBe(1);
		expect(samples[300]).toBeCloseTo(3, 5);
		// Gentler with a smaller setting.
		const light = ones();
		shapeAttack(light, rate, [0.1], 15);
		expect(light[100]).toBeCloseTo(1.3, 5);
	});

	it('fades strong notes in with a negative setting', () => {
		const samples = ones();
		shapeAttack(samples, rate, [0.1], -100);
		expect(samples[100]).toBe(0);
		expect(samples[110]).toBeGreaterThan(0);
		expect(samples[120]).toBeGreaterThan(samples[110]);
		expect(samples[100 + window]).toBe(1);
	});

	it('ends each onset’s shaping at the next', () => {
		const samples = ones();
		shapeAttack(samples, rate, [0.1, 0.12], 100);
		expect(samples[119]).toBeLessThan(3);
		expect(samples[120]).toBeCloseTo(3, 5);
	});

	it('changes nothing at 0', () => {
		const samples = ones();
		shapeAttack(samples, rate, [0.1, 0.2], 0);
		expect(samples).toEqual(ones());
	});
});

describe('settings', () => {
	it('normalizes stored settings', () => {
		expect(normalizeHumanize(undefined)).toEqual(HUMANIZE_DEFAULTS);
		expect(
			normalizeHumanize({ style: 'bluegrass', lilt: 400, accent: 'x', attack: -12.4 })
		).toEqual({ style: 'irish', lilt: 100, accent: HUMANIZE_DEFAULTS.accent, attack: -12 });
		expect(normalizeHumanize({ style: 'oldtime', lilt: 0, accent: 0, attack: 0 })).toEqual({
			style: 'oldtime',
			lilt: 0,
			accent: 0,
			attack: 0
		});
		expect(isHumanizeOff({ ...HUMANIZE_OFF, style: 'oldtime' })).toBe(true);
		expect(isHumanizeOff(HUMANIZE_DEFAULTS)).toBe(false);
	});

	it('keys renderings only when it changes something', () => {
		expect(humanizeKey(HUMANIZE_OFF)).toBeUndefined();
		expect(humanizeKey({ ...HUMANIZE_OFF, style: 'oldtime' })).toBeUndefined();
		expect(humanizeKey(HUMANIZE_DEFAULTS)).toBe('h20,20,15');
		expect(humanizeKey({ ...HUMANIZE_DEFAULTS, style: 'oldtime' })).toBe('h20,20,15o');
		// The style changes nothing with the lilt alone.
		expect(humanizeKey({ style: 'oldtime', lilt: -30, accent: 0, attack: 0 })).toBe('h-30,0,0');
	});
});
