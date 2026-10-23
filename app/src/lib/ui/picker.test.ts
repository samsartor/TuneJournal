import { describe, expect, it } from 'vitest';
import {
	formatPostedDate,
	incipitAbc,
	keyCounts,
	otherNames,
	postedBy,
	settingKeyLabel,
	tuneSummary,
	typeMeter
} from './picker.ts';

const member = (name: string | null) => ({ id: 1, name, url: 'https://thesession.org/members/1' });

describe('typeMeter', () => {
	it('gives the usual meter of known types', () => {
		expect(typeMeter('reel')).toBe('4/4');
		expect(typeMeter('Slip  Jig')).toBe('9/8');
		expect(typeMeter('polka')).toBe('2/4');
	});

	it('gives nothing for unknown or missing types', () => {
		expect(typeMeter('march')).toBeUndefined();
		expect(typeMeter(undefined)).toBeUndefined();
	});
});

describe('settingKeyLabel and keyCounts', () => {
	it('formats thesession keys', () => {
		expect(settingKeyLabel('Edorian')).toBe('E dor');
		expect(settingKeyLabel('nonsense')).toBe('nonsense');
	});

	it('counts keys, most common first', () => {
		const settings = [{ key: 'Edorian' }, { key: 'Eminor' }, { key: 'Eminor' }];
		expect(keyCounts(settings)).toEqual([
			['E min', 2],
			['E dor', 1]
		]);
		expect(keyCounts([])).toEqual([]);
	});
});

describe('formatPostedDate and postedBy', () => {
	it('reads thesession dates without a time zone shift', () => {
		expect(formatPostedDate('2001-05-14 18:45:18')).toBe('14 May 2001');
		expect(formatPostedDate('2008-12-01 00:00:00')).toBe('1 Dec 2008');
	});

	it('ignores dates it can’t read', () => {
		expect(formatPostedDate('')).toBeUndefined();
		expect(formatPostedDate('yesterday')).toBeUndefined();
		expect(formatPostedDate('2001-13-01')).toBeUndefined();
		expect(formatPostedDate(undefined)).toBeUndefined();
	});

	it('names the member and the date when known', () => {
		const date = '2001-05-14 18:45:18';
		expect(postedBy({ member: member('Jeremy'), date })).toBe('Jeremy, 14 May 2001');
		expect(postedBy({ member: member(null), date })).toBe('14 May 2001');
		expect(postedBy({ member: member('Jeremy'), date: '' })).toBe('Jeremy');
		expect(postedBy({ member: member(' '), date: '' })).toBeUndefined();
	});
});

describe('incipitAbc', () => {
	it('makes a short tune of the opening bars, pickup kept', () => {
		const abc = incipitAbc(
			{ abc: '|:D2|EBBA B2 EB|B2 AB dBAG|FDAD BDAD|', key: 'Edorian' },
			'reel'
		);
		expect(abc).toBe('X:1\nM:4/4\nL:1/8\nK:Edor\nD2 | EBBA B2 EB | B2 AB dBAG |]\n');
	});

	it('uses the type’s meter, or common time', () => {
		expect(incipitAbc({ abc: 'ABc def|', key: 'Dmajor' }, 'jig')).toContain('M:6/8\n');
		expect(incipitAbc({ abc: 'ABcd|', key: 'Gmajor' }, 'march')).toContain('M:4/4\nL:1/8\nK:Gmaj');
	});
});

describe('tuneSummary and otherNames', () => {
	it('sums up settings, keys and tunebooks', () => {
		const settings = [{ key: 'Edorian' }, { key: 'Eminor' }, { key: 'Eminor' }];
		expect(tuneSummary({ settings, tunebooks: 6826 } as never)).toBe(
			'3 settings (E min ×2, E dor) · 6,826 tunebooks'
		);
		expect(tuneSummary({ settings: [{ key: 'Gmajor' }], tunebooks: 1 } as never)).toBe(
			'1 setting (G maj) · 1 tunebook'
		);
		expect(tuneSummary({ settings: [], tunebooks: 0 } as never)).toBe('0 settings · 0 tunebooks');
	});

	it('leaves out the name, the matched alias and mere respellings', () => {
		const aliases = [
			"Cooley's",
			'Cooleys',
			'Joe Cooley',
			"Joe Cooley's",
			'Joe Cooleys',
			'The Tulla'
		];
		expect(otherNames("Cooley's", aliases)).toEqual(['Joe Cooley', "Joe Cooley's", 'The Tulla']);
		expect(otherNames("Cooley's", aliases, 'joe cooley')).toEqual(["Joe Cooley's", 'The Tulla']);
		expect(otherNames('X', [])).toEqual([]);
	});
});
