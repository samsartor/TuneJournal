import { describe, expect, it } from 'vitest';
import {
	clampRate,
	clampTime,
	clipBounds,
	endAction,
	formatRate,
	formatTime,
	parseTime,
	playFrom,
	progress,
	stepRate,
	trimLabel
} from './bounds';

describe('clip bounds', () => {
	it('uses the trim, clamped to the media', () => {
		expect(clipBounds({}, 30)).toEqual({ start: 0, end: 30 });
		expect(clipBounds({ start: 5, end: 10 }, 30)).toEqual({ start: 5, end: 10 });
		expect(clipBounds({ start: 5, end: 99 }, 30)).toEqual({ start: 5, end: 30 });
		expect(clipBounds({ start: 5 })).toEqual({ start: 5, end: Infinity });
		expect(clipBounds({ end: 8 })).toEqual({ start: 0, end: 8 });
	});

	it('falls back to the whole media for a trim outside it', () => {
		expect(clipBounds({ start: 40, end: 50 }, 30)).toEqual({ start: 0, end: 30 });
		expect(clipBounds({ start: 10, end: 5 }, 30)).toEqual({ start: 10, end: 30 });
		expect(clipBounds({ start: -3 }, NaN)).toEqual({ start: 0, end: Infinity });
	});

	it('clamps, loops and stops at the end', () => {
		const b = { start: 2, end: 6 };
		expect(clampTime(1, b)).toBe(2);
		expect(clampTime(7, b)).toBe(6);
		expect(endAction(3, b, false)).toBe('continue');
		expect(endAction(5.99, b, false)).toBe('stop');
		expect(endAction(6.2, b, true)).toBe('loop');
		expect(endAction(1e9, { start: 0, end: Infinity }, true)).toBe('continue');
	});

	it('play starts from the clip start when outside it', () => {
		const b = { start: 2, end: 6 };
		expect(playFrom(3, b)).toBe(3);
		expect(playFrom(0, b)).toBe(2);
		expect(playFrom(6, b)).toBe(2);
	});

	it('progress', () => {
		expect(progress(4, { start: 2, end: 6 })).toBe(0.5);
		expect(progress(9, { start: 2, end: 6 })).toBe(1);
		expect(progress(4, { start: 2, end: Infinity })).toBe(0);
	});
});

describe('speed', () => {
	it('clamps and rounds', () => {
		expect(clampRate(0.756)).toBe(0.76);
		expect(clampRate(0.1)).toBe(0.25);
		expect(clampRate(5)).toBe(2);
		expect(clampRate(NaN)).toBe(1);
	});

	it('steps by 5%, snapping to the grid', () => {
		expect(stepRate(0.9, 1)).toBe(0.95);
		expect(stepRate(0.9, -1)).toBe(0.85);
		expect(stepRate(0.92, 1)).toBe(0.95);
		expect(stepRate(0.92, -1)).toBe(0.9);
		expect(stepRate(0.6, -1)).toBe(0.55);
		expect(stepRate(1, 1)).toBe(1.05);
		expect(stepRate(0.25, -1)).toBe(0.25);
		// No float drift over many steps.
		let r = 0.5;
		for (let i = 0; i < 10; i++) r = stepRate(r, 1);
		expect(r).toBe(1);
	});

	it('formats', () => {
		expect(formatRate(0.75)).toBe('75%');
		expect(formatRate(1)).toBe('100%');
	});
});

describe('time', () => {
	it('formats', () => {
		expect(formatTime(5)).toBe('0:05');
		expect(formatTime(65.9)).toBe('1:05');
		expect(formatTime(3723)).toBe('1:02:03');
		expect(formatTime(1.25, 1)).toBe('0:01.2');
		expect(formatTime(Infinity)).toBe('–:––');
	});

	it('parses', () => {
		expect(parseTime('75')).toBe(75);
		expect(parseTime('1:15')).toBe(75);
		expect(parseTime('1:15.5')).toBe(75.5);
		expect(parseTime('1:02:03')).toBe(3723);
		expect(parseTime('x')).toBeUndefined();
		expect(parseTime('1::2')).toBeUndefined();
	});

	it('labels a trim', () => {
		expect(trimLabel({})).toBeUndefined();
		expect(trimLabel({ start: 12, end: 45 })).toBe('0:12–0:45');
		expect(trimLabel({ start: 12 }, 90)).toBe('0:12–1:30');
		expect(trimLabel({ start: 12 })).toBe('0:12–end');
	});
});
