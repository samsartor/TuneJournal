import abcjs from 'abcjs';
import { describe, expect, it } from 'vitest';
import { buildTuneAbc, secondsPerWhole } from '#lib/domain/synth.ts';
import tune from '#lib/integrations/fixtures/tune-1.json';
import {
	barWindows,
	closingBar,
	measureOf,
	noteAt,
	openingBar,
	playedBars,
	scoreMap,
	windowAbc,
	windowAt,
	type BarMark
} from './follow.ts';

/** Bar lines at the given characters, each one character long. */
const barsAt = (...chars: number[]): BarMark[] =>
	chars.map((c) => ({ startChar: c, endChar: c + 1 }));

describe('measureOf', () => {
	const bars = barsAt(0, 10, 20);
	it('counts the bar lines before a character', () => {
		expect(measureOf(bars, 0)).toBe(0);
		expect(measureOf(bars, 1)).toBe(1);
		expect(measureOf(bars, 9)).toBe(1);
		expect(measureOf(bars, 11)).toBe(2);
		expect(measureOf(bars, 25)).toBe(3);
	});
});

describe('playedBars', () => {
	const bars = barsAt(10, 20, 30);
	it('follows the measures in the order they are played, repeats included', () => {
		const notes = [
			{ start: 0, startChar: 1 },
			{ start: 1, startChar: 11 },
			{ start: 2, startChar: 1 }, // the repeat
			{ start: 3, startChar: 11 },
			{ start: 4, startChar: 21 }
		];
		expect(playedBars(notes, bars, 5)).toEqual([
			{ measure: 0, start: 0, end: 1 },
			{ measure: 1, start: 1, end: 2 },
			{ measure: 0, start: 2, end: 3 },
			{ measure: 1, start: 3, end: 4 },
			{ measure: 2, start: 4, end: 5 }
		]);
	});

	it('starts a new entry when a measure repeats itself', () => {
		const notes = [
			{ start: 0, startChar: 11 },
			{ start: 0.5, startChar: 15 },
			{ start: 1, startChar: 11 },
			{ start: 1.5, startChar: 15 }
		];
		expect(playedBars(notes, bars, 2).map((b) => [b.measure, b.start, b.end])).toEqual([
			[1, 0, 1],
			[1, 1, 2]
		]);
	});
});

describe('barWindows', () => {
	const bar = (measure: number, start: number, length = 1) => ({
		measure,
		start,
		end: start + length
	});

	it('pairs full bars', () => {
		const played = [bar(1, 0), bar(2, 1), bar(3, 2), bar(4, 3), bar(5, 4)];
		expect(barWindows(played, 1)).toEqual([
			{ start: 0, end: 2, measures: [1, 2] },
			{ start: 2, end: 4, measures: [3, 4] },
			{ start: 4, end: 5, measures: [5] }
		]);
	});

	it('keeps a pickup with the two bars after it, and the end of a part with the pickup back', () => {
		const played = [
			bar(1, 0, 0.25), // pickup
			bar(2, 0.25),
			bar(3, 1.25),
			bar(4, 2.25),
			bar(5, 3.25, 0.75), // the last bar, short by the pickup
			bar(1, 4, 0.25), // the pickup again (the repeat)
			bar(2, 4.25),
			bar(3, 5.25)
		];
		expect(barWindows(played, 1).map((w) => w.measures)).toEqual([
			[1, 2, 3],
			[4, 5, 1],
			[2, 3]
		]);
	});
});

describe('windowAt and noteAt', () => {
	const windows = [
		{ start: 0, end: 2, measures: [1] },
		{ start: 2, end: 4, measures: [2] },
		{ start: 4, end: 6, measures: [3] }
	];
	it('finds the window playing, clamped to the ends', () => {
		expect(windowAt(windows, -1)).toBe(0);
		expect(windowAt(windows, 0)).toBe(0);
		expect(windowAt(windows, 1.99)).toBe(0);
		expect(windowAt(windows, 2)).toBe(1);
		expect(windowAt(windows, 5)).toBe(2);
		expect(windowAt(windows, 99)).toBe(2);
		expect(windowAt([], 1)).toBe(-1);
	});

	it('finds the note sounding', () => {
		const notes = [0, 0.5, 1].map((start, i) => ({ start, startChar: i }));
		expect(noteAt(notes, -0.1)).toBe(-1);
		expect(noteAt(notes, 0.7)).toBe(1);
		expect(noteAt(notes, 3)).toBe(2);
	});
});

describe('bar lines at the edges of a window', () => {
	it('opens without ending a repeat', () => {
		expect(openingBar('|:')).toBe('|:');
		expect(openingBar(':|2')).toBe('|2');
		expect(openingBar(':|[2')).toBe('|[2');
		expect(openingBar('::')).toBe('|:');
		expect(openingBar(':|')).toBe('|');
		expect(openingBar('|]')).toBe('|');
		expect(openingBar('|1')).toBe('|1');
	});

	it('closes without the number of the ending after it', () => {
		expect(closingBar('|1')).toBe('|');
		expect(closingBar(':|2')).toBe(':|');
		expect(closingBar(':|[2')).toBe(':|');
		expect(closingBar('[1')).toBe('|');
		expect(closingBar('||')).toBe('||');
	});
});

describe('scoreMap and windowAbc (with abcjs)', () => {
	const cooleys = tune.settings[0];
	const whole = (abc: string) => {
		const t = buildTuneAbc({ abc, key: 'Edorian', type: 'reel' }, 2);
		return { abc: t.abc, wholeNote: secondsPerWhole(t.tempo) };
	};

	it('follows a reel with a pickup and repeats, twice through', () => {
		const { abc, wholeNote } = whole(cooleys.abc);
		const map = scoreMap(abcjs, abc, wholeNote)!;
		// A reel at 1/2=100: 1.2 s a bar. The pickup goes with the first two bars.
		expect(wholeNote).toBeCloseTo(1.2);
		const first = map.windows[0];
		expect(first.start).toBe(0);
		expect(first.end).toBeCloseTo(2.7);
		expect(windowAbc(map, first.measures).abc).toBe(
			'X:1\nM:4/4\nL:1/8\nK:Edor\n|:D2|EBBA B2 EB|B2 AB dBAG|\n'
		);
		// The end of the A part, with the pickup back to its start, then again into the B part.
		const ends = map.windows
			.map((w) => windowAbc(map, w.measures).abc.split('\n').at(-2))
			.filter((line) => line?.startsWith('|afec'));
		// A part and its repeat, B part and its repeat, then the same the second time through.
		expect(ends).toEqual([
			'|afec dBAF|DEFD E2:|:D2|',
			'|afec dBAF|DEFD E2:|:gf|',
			'|afec dBAF|DEFD E2:|:gf|',
			'|afec dBAF|DEFD E2:|:D2|',
			'|afec dBAF|DEFD E2:|:D2|',
			'|afec dBAF|DEFD E2:|:gf|',
			'|afec dBAF|DEFD E2:|:gf|',
			'|afec dBAF|DEFD E2:|'
		]);
		// Twice through, each part twice: 2 × 2 × 8 bars, two to a window.
		expect(map.windows).toHaveLength(32);
		expect(map.windows.at(-1)!.end).toBeCloseTo(2 * 2 * 2 * 8 * 1.2);
	});

	it('maps first and second endings', () => {
		const { abc, wholeNote } = whole('|:EBBA B2 EB|B2 AB dBAG|1FDAD dAFD:|2FDAD E4||');
		const map = scoreMap(abcjs, abc, wholeNote)!;
		const lines = map.windows.map((w) => windowAbc(map, w.measures).abc.split('\n').at(-2));
		expect(lines.slice(0, 4)).toEqual([
			'|:EBBA B2 EB|B2 AB dBAG|',
			'|1FDAD dAFD:|:EBBA B2 EB|',
			'|B2 AB dBAG|2FDAD E4||',
			'|:EBBA B2 EB|B2 AB dBAG|'
		]);
	});

	it('maps a note of the tune to the same note in its window', () => {
		const { abc, wholeNote } = whole(cooleys.abc);
		const map = scoreMap(abcjs, abc, wholeNote)!;
		const w = map.windows[1];
		const slice = windowAbc(map, w.measures);
		const i = noteAt(map.notes, w.start);
		const char = slice.charAt(map.notes[i].startChar);
		expect(slice.abc.slice(char, char + 4)).toBe('FDAD');
		expect(slice.charAt(0)).toBe(-1);
	});
});
