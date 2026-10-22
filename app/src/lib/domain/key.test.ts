import { describe, expect, it } from 'vitest';
import { formatKey, normalizeKey, parseKey } from './key';
import { relativeTime } from './format';

describe('parseKey', () => {
	it.each([
		['D', 'D', 'major'],
		['Dmaj', 'D', 'major'],
		['d major', 'D', 'major'],
		['Em', 'E', 'minor'],
		['Emin', 'E', 'minor'],
		['Edorian', 'E', 'dorian'],
		['Ador', 'A', 'dorian'],
		['A Mix', 'A', 'mixolydian'],
		['f# min', 'F#', 'minor'],
		['Bb', 'Bb', 'major'],
		['B♭ lydian', 'Bb', 'lydian'],
		['C ionian', 'C', 'major'],
		['G aeolian', 'G', 'minor']
	])('%s → %s %s', (input, tonic, mode) => {
		expect(parseKey(input)).toEqual({ tonic, mode });
	});

	it.each(['', 'H', 'D mi', 'D majorly', 'something'])('rejects %j', (input) => {
		expect(parseKey(input)).toBeUndefined();
	});
});

describe('normalizeKey and formatKey', () => {
	it('stores tonic + full mode and displays the short form', () => {
		expect(normalizeKey(' Ador ')).toBe('A dorian');
		expect(formatKey('A dorian')).toBe('A dor');
		expect(formatKey('F# minor')).toBe('F# min');
	});

	it('keeps free text and drops blanks', () => {
		expect(normalizeKey('  odd   one ')).toBe('odd one');
		expect(formatKey('odd one')).toBe('odd one');
		expect(normalizeKey('   ')).toBeUndefined();
	});
});

describe('relativeTime', () => {
	const now = Date.UTC(2026, 9, 22, 12);
	const ago = (ms: number) => relativeTime(now - ms, now, 'en');
	const MIN = 60_000;
	const DAY = 24 * 60 * MIN;

	it('reads naturally', () => {
		expect(ago(10_000)).toBe('just now');
		expect(ago(5 * MIN)).toBe('5 minutes ago');
		expect(ago(3 * 60 * MIN)).toBe('3 hours ago');
		expect(ago(DAY)).toBe('yesterday');
		expect(ago(3 * DAY)).toBe('3 days ago');
		expect(ago(14 * DAY)).toBe('2 weeks ago');
		expect(ago(65 * DAY)).toBe('2 months ago');
		expect(ago(800 * DAY)).toBe('2 years ago');
	});
});
