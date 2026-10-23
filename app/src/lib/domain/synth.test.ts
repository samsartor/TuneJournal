import { describe, expect, it } from 'vitest';
import { HUMANIZE_OFF } from './humanize';
import { clipPlayback } from './providers';
import {
	DEFAULT_SYNTH_OPTIONS,
	INSTRUMENTS,
	SOUNDFONT_RANGES,
	TUNE_TYPES,
	abcKey,
	buildTuneAbc,
	foldPitch,
	hashText,
	isSynthCacheKey,
	parseTempo,
	renderRequest,
	secondsPerWhole,
	synthCacheFamily,
	synthCacheKey,
	synthTarget,
	tuneType
} from './synth';
import type { Source } from './types';

const COOLEYS =
	'|:D2|EBBA B2 EB|B2 AB dBAG|FDAD BDAD|FDAD dAFD|! EBBA B2 EB|B2 AB defg|afec dBAF|DEFD E2:|';

describe('tune types and tempo', () => {
	it('has a meter and a folk tempo for each thesession type', () => {
		expect(tuneType('reel')).toEqual({ meter: '4/4', tempo: { unit: [1, 2], bpm: 100 } });
		expect(tuneType('Jig')).toEqual({ meter: '6/8', tempo: { unit: [3, 8], bpm: 110 } });
		expect(tuneType('slip  jig').meter).toBe('9/8');
		expect(tuneType('hornpipe').tempo).toEqual({ unit: [1, 2], bpm: 80 });
		expect(tuneType('polka').meter).toBe('2/4');
		expect(tuneType('slide').meter).toBe('12/8');
		expect(tuneType('three-two').meter).toBe('3/2');
		expect(tuneType('waltz').meter).toBe('3/4');
		// Unknown or missing: common time at a walking pace.
		expect(tuneType('schottische')).toEqual({ meter: '4/4', tempo: { unit: [1, 4], bpm: 120 } });
		expect(tuneType(undefined).meter).toBe('4/4');
		for (const type of Object.values(TUNE_TYPES)) expect(type.tempo.bpm).toBeGreaterThan(0);
	});

	it('converts a tempo to seconds per whole note', () => {
		// A reel at minim = 100: 1.2 s a bar of 4/4.
		expect(secondsPerWhole({ unit: [1, 2], bpm: 100 })).toBeCloseTo(1.2);
		// A jig at dotted crotchet = 110: two beats, 1.09 s a bar of 6/8.
		expect(secondsPerWhole({ unit: [3, 8], bpm: 110 }) * 0.75).toBeCloseTo(60 / 55);
		expect(secondsPerWhole({ unit: [1, 4], bpm: 120 })).toBeCloseTo(2);
	});

	it('reads a Q: field', () => {
		expect(parseTempo('Q:1/2=100')).toEqual({ unit: [1, 2], bpm: 100 });
		expect(parseTempo('X:1\nQ: 3/8 = 120\nK:D')).toEqual({ unit: [3, 8], bpm: 120 });
		expect(parseTempo('Q:"Briskly" 1/4=132')).toEqual({ unit: [1, 4], bpm: 132 });
		expect(parseTempo('abc [Q:1/4=90] def')).toEqual({ unit: [1, 4], bpm: 90 });
		expect(parseTempo('Q:140')).toEqual({ unit: [1, 4], bpm: 140 });
		expect(parseTempo('Q:"Slowly"')).toBeUndefined();
		expect(parseTempo('Q:1/4=0')).toBeUndefined();
		expect(parseTempo(COOLEYS)).toBeUndefined();
	});
});

describe('building a whole tune from a setting', () => {
	it('adds a header from the tune type and key, and repeats the body', () => {
		const tune = buildTuneAbc({ abc: COOLEYS, key: 'Edorian', type: 'reel', title: "Cooley's" }, 2);
		expect(tune.ownTempo).toBe(false);
		expect(tune.tempo).toEqual({ unit: [1, 2], bpm: 100 });
		const lines = tune.abc.trim().split('\n');
		expect(lines.slice(0, 7)).toEqual([
			'X:1',
			"T:Cooley's",
			'R:reel',
			'M:4/4',
			'L:1/8',
			'Q:1/2=100',
			'K:Edor'
		]);
		// thesession's `!` line breaks become new lines; the body comes twice, repeats intact.
		const body = lines.slice(7);
		expect(body).toEqual([
			'|:D2|EBBA B2 EB|B2 AB dBAG|FDAD BDAD|FDAD dAFD|',
			'EBBA B2 EB|B2 AB defg|afec dBAF|DEFD E2:|',
			'|:D2|EBBA B2 EB|B2 AB dBAG|FDAD BDAD|FDAD dAFD|',
			'EBBA B2 EB|B2 AB defg|afec dBAF|DEFD E2:|'
		]);
	});

	it('plays 1 to 4 times through', () => {
		const count = (times: number) =>
			buildTuneAbc({ abc: 'ABcd|', type: 'reel' }, times).abc.match(/ABcd/g)?.length;
		expect(count(1)).toBe(1);
		expect(count(3)).toBe(3);
		expect(count(0)).toBe(1);
		expect(count(9)).toBe(4);
	});

	it('keeps the setting’s own tempo', () => {
		const tune = buildTuneAbc({ abc: 'Q:1/4=90\nABcd|', type: 'reel' });
		expect(tune.ownTempo).toBe(true);
		expect(tune.tempo).toEqual({ unit: [1, 4], bpm: 90 });
		expect(tune.abc).not.toMatch(/^Q:1\/2/m);
	});

	it('restates key, meter and length before a repeat when the body changes them', () => {
		const abc = buildTuneAbc({ abc: 'ABcd|!K:Ador!eaag|', key: 'Dmajor', type: 'jig' }, 2).abc;
		expect(abc).toContain('eaag|\nM:6/8\nL:1/8\nK:Dmaj\nABcd|');
		const plain = buildTuneAbc({ abc: 'ABcd|', key: 'Dmajor', type: 'jig' }, 2).abc;
		expect(plain.match(/K:/g)).toHaveLength(1);
	});

	it('writes keys the ABC way', () => {
		expect(abcKey('Edorian')).toBe('Edor');
		expect(abcKey('F# minor')).toBe('F#min');
		expect(abcKey('Gmajor')).toBe('Gmaj');
		expect(abcKey('A mixolydian')).toBe('Amix');
		expect(abcKey(undefined)).toBe('C');
		expect(abcKey('nonsense')).toBe('C');
	});
});

describe('render requests and the audio cache key', () => {
	const tune = buildTuneAbc({ abc: COOLEYS, key: 'Edorian', type: 'reel' });

	it('carries the 100% tempo and the speed separately', () => {
		const request = renderRequest(tune, DEFAULT_SYNTH_OPTIONS, 0.753);
		expect(request.wholeNote).toBeCloseTo(1.2);
		expect(request.tempo).toBe(0.75);
		expect(request).toMatchObject({
			instrument: 'fiddle',
			chords: false,
			transpose: 0,
			timesThrough: 2,
			humanize: HUMANIZE_OFF
		});
	});

	it('keys renderings by setting, ABC, options and tempo', () => {
		const at = (rate: number, options = DEFAULT_SYNTH_OPTIONS, transpose = 0) =>
			synthCacheKey(1, renderRequest(tune, options, rate, transpose));
		const plain = { ...DEFAULT_SYNTH_OPTIONS, humanize: HUMANIZE_OFF };
		const key = at(1, plain);
		// Without humanization, the key renderings had before it existed.
		expect(key).toMatch(/^synth:v\d+:s1:[0-9a-f]{8}:fiddle:melody@1\.00$/);
		// The default options are as written.
		expect(at(1)).toBe(key);
		// With it, a part per setting, so each slider position is its own rendering.
		const human = (h: Partial<typeof HUMANIZE_OFF>) =>
			at(1, { ...plain, humanize: { ...HUMANIZE_OFF, ...h } });
		expect(human({ lilt: 1.5, accent: -20 })).toBe(key.replace('@', ':hr1.5,-20,0@'));
		expect(human({ accent: 30, attack: 10 })).toContain(':hr1,30,10@');
		expect(human({ lilt: 0.8 })).toContain(':hr0.8,0,0@');
		expect(new Set([human({ lilt: 1.1 }), human({ lilt: 1.15 }), human({ accent: 25 })]).size).toBe(
			3
		);
		expect(isSynthCacheKey(key)).toBe(true);
		expect(isSynthCacheKey('upload-id')).toBe(false);
		expect(at(0.75, plain)).toBe(key.replace('@1.00', '@0.75'));
		expect(at(1, { ...plain, instrument: 'flute' })).toContain(':flute:');
		expect(at(1, { ...plain, chords: true })).toContain(':chords@');
		expect(at(1, plain, -2)).toContain(':t-2@');
		// Times through changes the ABC, so the hash.
		const twice = synthCacheKey(1, renderRequest(buildTuneAbc({ abc: COOLEYS }, 3), plain));
		expect(twice).not.toBe(key);
		// Every speed of one rendering shares a family, for pruning.
		const family = synthCacheFamily(1, renderRequest(tune, plain, 0.6));
		expect(key.startsWith(`${family}@`)).toBe(true);
	});

	it('hashes text stably', () => {
		expect(hashText('abc')).toBe(hashText('abc'));
		expect(hashText('abc')).not.toBe(hashText('abd'));
		expect(hashText('')).toMatch(/^[0-9a-f]{8}$/);
	});
});

describe('instruments and options', () => {
	it('has samples for every instrument', () => {
		for (const inst of Object.values(INSTRUMENTS)) {
			const range = SOUNDFONT_RANGES[inst.sample];
			expect(range).toBeDefined();
			expect(range[1] - range[0]).toBeGreaterThanOrEqual(11);
		}
	});

	it('folds pitches into a range by octaves', () => {
		expect(foldPitch(62, [55, 88])).toBe(62);
		expect(foldPitch(43, [55, 88])).toBe(55);
		expect(foldPitch(40, [55, 88])).toBe(64);
		expect(foldPitch(100, [55, 88])).toBe(88);
		expect(foldPitch(101, [55, 88])).toBe(77);
	});
});

describe('which recordings play synthesized', () => {
	const tuneLink: Source = {
		id: 'thesession:tune:1' as Source['id'],
		provider: 'thesession',
		url: 'https://thesession.org/tunes/1',
		externalId: '1',
		addedAt: 0
	};
	const linked = { external: { thesession: { tuneId: 1, settingId: 12342 } } };

	it('finds the piece’s chosen setting of the linked tune', () => {
		expect(synthTarget(linked, tuneLink)).toEqual({ tuneId: 1, settingId: 12342 });
		// No setting chosen, another tune, a set link, or not thesession at all: nothing.
		expect(synthTarget({ external: { thesession: { tuneId: 1 } } }, tuneLink)).toBeUndefined();
		expect(synthTarget({ external: { thesession: { tuneId: 2, settingId: 5 } } }, tuneLink)).toBe(
			undefined
		);
		expect(synthTarget(linked, { ...tuneLink, externalId: 'set:9' })).toBeUndefined();
		expect(synthTarget({}, tuneLink)).toBeUndefined();
		expect(synthTarget(linked, { ...tuneLink, provider: 'youtube' })).toBeUndefined();
	});

	it('plays in the app when the ABC is at hand, else links out', () => {
		expect(clipPlayback(tuneLink, { settingId: 12342, available: true })).toBe('synth');
		// Offline and never loaded on this device.
		expect(clipPlayback(tuneLink, { settingId: 12342, available: false })).toBe('link');
		// No setting chosen.
		expect(clipPlayback(tuneLink, { available: true })).toBe('link');
		expect(clipPlayback(tuneLink)).toBe('link');
		// Other providers are unaffected.
		expect(clipPlayback({ provider: 'upload', url: '' }, { settingId: 1, available: true })).toBe(
			'file'
		);
		expect(clipPlayback({ provider: 'youtube', url: '' })).toBe('youtube');
	});
});
