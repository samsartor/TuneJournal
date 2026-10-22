import { describe, expect, it, vi } from 'vitest';
import search from './fixtures/search-cooley.json';
import tune from './fixtures/tune-1.json';
import sets from './fixtures/tune-1-sets.json';
import recordings from './fixtures/tune-1-recordings.json';
import {
	TheSessionClient,
	TheSessionError,
	firstBars,
	parseKey,
	parseRecordings,
	parseSearch,
	parseSets,
	parseTune
} from './thesession';

describe('parsers', () => {
	it('parses search results', () => {
		const r = parseSearch(search);
		expect(r.total).toBe(10);
		expect(r.tunes[0]).toEqual({
			id: 1,
			name: "Cooley's",
			url: 'https://thesession.org/tunes/1',
			type: 'reel',
			date: '2001-05-14 18:45:18'
		});
	});

	it('parses a tune with settings and aliases', () => {
		const t = parseTune(tune);
		expect(t.id).toBe(1);
		expect(t.type).toBe('reel');
		expect(t.aliases).toContain('The Tulla');
		expect(t.recordings).toBe(3);
		expect(t.settings.map((s) => s.key)).toEqual(['Edorian', 'Eminor', 'Eminor']);
		expect(t.settings[0].abc).toMatch(/^\|:D2\|EBBA B2 EB\|/);
	});

	it('parses sets and recovers tune ids from setting URLs', () => {
		const s = parseSets(sets);
		expect(s.sets).toHaveLength(2);
		const cooleys = s.sets[0].tunes.find((e) => e.name === "Cooley's");
		expect(cooleys).toMatchObject({ settingId: 1, tuneId: 1, key: 'Edor', meter: '4/4' });
		expect(s.sets[1].tunes[1]).toMatchObject({ settingId: 23247, tuneId: 13305 });
	});

	it('parses recordings', () => {
		const r = parseRecordings(recordings);
		expect(r.recordings.map((x) => x.id)).toEqual([3536, 872, 5240]);
		expect(r.recordings[0].artist.name).toBe('Accordéonistes Du Québec');
		expect(r.recordedWith[0]).toEqual({ id: 118, name: 'The Wise Maid', count: 14 });
	});

	it('rejects unexpected shapes', () => {
		expect(() => parseTune({ id: 1 })).toThrow(TheSessionError);
		expect(() => parseSearch([])).toThrow(TheSessionError);
	});
});

describe('parseKey', () => {
	it('normalizes full and abbreviated modes', () => {
		expect(parseKey('Edorian')).toEqual({ tonic: 'E', mode: 'dorian' });
		expect(parseKey('Edor')).toEqual({ tonic: 'E', mode: 'dorian' });
		expect(parseKey('Gmaj')).toEqual({ tonic: 'G', mode: 'major' });
		expect(parseKey('F#minor')).toEqual({ tonic: 'F#', mode: 'minor' });
		expect(parseKey('Bbmixolydian')).toEqual({ tonic: 'Bb', mode: 'mixolydian' });
	});

	it('returns undefined for junk', () => {
		expect(parseKey('')).toBeUndefined();
		expect(parseKey('Hmajor')).toBeUndefined();
		expect(parseKey('Dfoo')).toBeUndefined();
	});
});

describe('firstBars', () => {
	it('keeps a pickup without counting it', () => {
		const abc = parseTune(tune).settings[0].abc;
		expect(firstBars(abc)).toBe('D2 | EBBA B2 EB | B2 AB dBAG');
	});

	it('handles repeats and endings', () => {
		expect(firstBars('|:ABcd efga|[1 bagf edcB:|[2 bagf e4||', 3)).toBe(
			'ABcd efga | bagf edcB | bagf e4'
		);
		expect(firstBars('')).toBe('');
	});
});

describe('TheSessionClient', () => {
	it('requests JSON and parses the response', async () => {
		const fetch = vi.fn(async () => new Response(JSON.stringify(search)));
		const client = new TheSessionClient({ fetch });
		const r = await client.search('cooley', { type: 'reel' });
		expect(r.tunes).toHaveLength(3);
		const url = new URL(String((fetch.mock.calls[0] as unknown[])[0]));
		expect(url.origin + url.pathname).toBe('https://thesession.org/tunes/search');
		expect(Object.fromEntries(url.searchParams)).toEqual({
			q: 'cooley',
			type: 'reel',
			format: 'json'
		});
	});

	it('throws with the status on HTTP errors', async () => {
		const client = new TheSessionClient({
			fetch: async () => new Response('nope', { status: 404 })
		});
		await expect(client.tune(999999)).rejects.toMatchObject({ status: 404 });
	});
});
