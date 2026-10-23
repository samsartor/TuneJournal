import { describe, expect, it } from 'vitest';
import {
	ATTACK_SECONDS,
	HUMANIZE_OFF,
	LILT_NOTCHES,
	beatGroups,
	humanizeKey,
	humanizeNotes,
	isHumanizeOff,
	clampLilt,
	formatLilt,
	liltNotch,
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
	copies = 1
) => {
	const groups = beatGroups(starts, total, g, copies);
	return Array.from({ length: count }, (_, i) => stressAt(groups, g, from + i * E)[0]).join('');
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
		expect(pattern(grid(6, 8), starts, total, total1, 4, 2)).toBe('wsww');
		// Without knowing the times through, the second pickup counts as a short bar: from its start.
		expect(pattern(grid(6, 8), starts, total, total1, 4, 1)).toBe('ssww');
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
		const warp = liltWarp(groups, g, 1.5);
		for (let t = 0; t <= total; t += 2 * E) expect(warp(t)).toBeCloseTo(t, 9);
		const jig = grid(6, 8);
		const jigBars = bars(2, 6 / 8, E);
		const jigWarp = liltWarp(beatGroups(jigBars.starts, jigBars.total, jig), jig, 0.6);
		for (let t = E; t <= jigBars.total; t += 3 * E) expect(jigWarp(t)).toBeCloseTo(t, 9);
	});

	it('makes the strong quaver `ratio` times each of the others, monotonically', () => {
		const warp = liltWarp(groups, g, 2);
		// 2:1 pairs in a reel.
		expect(warp(E)).toBeCloseTo((4 / 3) * E, 9);
		expect(warp(2 * E) - warp(E)).toBeCloseTo((2 / 3) * E, 9);
		// 1.5:1: the first quaver 1.2 quavers long, the second 0.8.
		expect(liltWarp(groups, g, 1.5)(E)).toBeCloseTo(1.2 * E, 9);
		for (const ratio of [0.5, 0.8, 1.1, 1.5, 2]) {
			let last = -1;
			const w = liltWarp(groups, g, ratio);
			for (let t = 0; t <= total; t += 1 / 96) {
				expect(w(t)).toBeGreaterThanOrEqual(last);
				last = w(t);
			}
		}
	});

	it('in a jig, sets the first quaver against each of the other two', () => {
		const jig = grid(6, 8);
		const b = bars(2, 6 / 8);
		const warp = liltWarp(beatGroups(b.starts, b.total, jig), jig, 1.1);
		const first = warp(E);
		const second = warp(2 * E) - first;
		const third = warp(3 * E) - warp(2 * E);
		expect(first / second).toBeCloseTo(1.1, 9);
		expect(second).toBeCloseTo(third, 9);
		expect(warp(3 * E)).toBeCloseTo(3 * E, 9);
	});

	it('is the identity at 1 (Even)', () => {
		const warp = liltWarp(groups, g, 1);
		for (let t = 0; t <= total; t += 1 / 48) expect(warp(t)).toBe(t);
	});

	it('reverses below 1', () => {
		const warp = liltWarp(groups, g, 0.5);
		expect(warp(E)).toBeCloseTo((2 / 3) * E, 9);
		expect(warp(1 + E)).toBeLessThan(1 + E);
		expect(formatLilt(0.5)).toBe('1:2');
		expect(formatLilt(1 / 1.5)).toBe('1:1.5');
	});

	it('formats, clamps and notches the ratio', () => {
		expect(formatLilt(1)).toBe('Even');
		expect(formatLilt(1.5)).toBe('1.5:1');
		expect(formatLilt(1.33)).toBe('1.33:1');
		expect(clampLilt(5)).toBe(2);
		expect(clampLilt(0.1)).toBe(0.5);
		expect(clampLilt('x')).toBe(1);
		expect(clampLilt(-1)).toBe(1);
		// Symmetric notches on a log scale, Even in the middle.
		const mid = (LILT_NOTCHES.length - 1) / 2;
		expect(LILT_NOTCHES[mid]).toBe(1);
		expect(LILT_NOTCHES[0]).toBe(0.5);
		expect(LILT_NOTCHES.at(-1)).toBe(2);
		for (let i = 1; i < LILT_NOTCHES.length; i++)
			expect(LILT_NOTCHES[i]).toBeGreaterThan(LILT_NOTCHES[i - 1]);
		expect(LILT_NOTCHES[liltNotch(1.5)]).toBe(1.5);
		expect(LILT_NOTCHES[liltNotch(1.1)]).toBe(1.1);
		expect(liltNotch(1)).toBe(mid);
		expect(LILT_NOTCHES[liltNotch(1.52)]).toBe(1.5);
	});

	it('scales triplets and notes between grid lines consistently', () => {
		const warp = liltWarp(groups, g, 1.4);
		// A triplet of quavers over a crotchet: still in order, still ending on the next group.
		const triplet = [0, 1 / 12, 2 / 12, 3 / 12].map(warp);
		expect(triplet[3]).toBeCloseTo(0.25, 9);
		expect(triplet[1]).toBeGreaterThan(1 / 12);
		expect(triplet[2]).toBeGreaterThan(triplet[1]);
	});

	it('leaves a pickup’s partial group alone', () => {
		const jig = grid(6, 8);
		const b = bars(2, 6 / 8, 2 * E);
		const warp = liltWarp(beatGroups(b.starts, b.total, jig), jig, 2);
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
		expect(humanizeNotes(input(tracks, { lilt: 1.4, accent: 50, attack: 50 }, 7, 8))).toEqual([]);
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
		humanizeNotes(input([melody, bass], { lilt: 2 }));
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
		expect(humanizeNotes(input(tracks, { lilt: 1.4, accent: 0 }))).toEqual([]);
		const onsets = humanizeNotes(input([reelTrack()], { lilt: 1.4, attack: 30 }));
		expect(onsets).toEqual([0, 0.25, 0.5, 0.75, 1]);
		// A negative attack still shapes the strong onsets (fading them in), never the others.
		expect(humanizeNotes(input([reelTrack()], { attack: -30 }))).toEqual([0, 0.25, 0.5, 0.75, 1]);
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
		expect(normalizeHumanize(undefined)).toEqual(HUMANIZE_OFF);
		expect(normalizeHumanize({ style: 'oldtime', lilt: 400, accent: 'x', attack: -12.4 })).toEqual({
			lilt: 2,
			accent: 0,
			attack: -12
		});
		expect(normalizeHumanize({ lilt: 1.5, accent: -20, attack: 0 })).toEqual({
			lilt: 1.5,
			accent: -20,
			attack: 0
		});
		expect(isHumanizeOff(HUMANIZE_OFF)).toBe(true);
		expect(isHumanizeOff({ lilt: 1.1, accent: 0, attack: 0 })).toBe(false);
		expect(isHumanizeOff({ lilt: 1, accent: -5, attack: 0 })).toBe(false);
	});

	it('keys renderings only when it changes something', () => {
		expect(humanizeKey(HUMANIZE_OFF)).toBeUndefined();
		expect(humanizeKey({ lilt: 1.5, accent: -20, attack: 0 })).toBe('hr1.5,-20,0');
		expect(humanizeKey({ lilt: 1, accent: 30, attack: 10 })).toBe('hr1,30,10');
		expect(humanizeKey({ lilt: 1 / 1.5, accent: 0, attack: 0 })).toBe('hr0.667,0,0');
	});
});
