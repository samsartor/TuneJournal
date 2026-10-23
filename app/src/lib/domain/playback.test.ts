import { describe, expect, it } from 'vitest';
import * as Automerge from '@automerge/automerge';
import { SCHEMA_VERSION, emptyLibrary, migrate } from './library';
import { addTag, createPiece } from './ops';
import {
	AS_WRITTEN,
	SEED_PROFILES,
	addProfile,
	matchProfile,
	moveProfile,
	normalizeProfile,
	parseLegacySynthOptions,
	playbackOf,
	profileFor,
	removeProfile,
	restoreProfile,
	seedPlayback,
	seededFeel,
	sortedProfiles,
	synthOptionsFor,
	updateProfile
} from './playback';
import { linkPieces } from './relations';
import type { Library, PieceKind } from './types';

function piece(lib: Library, tags: string[], kind: PieceKind = 'tune', created = 0) {
	const id = createPiece(lib, { kind, now: created });
	for (const t of tags) addTag(lib, id, t, created);
	return id;
}

const labels = (lib: Library) => sortedProfiles(playbackOf(lib)).map((p) => p.label);

describe('seeded profiles', () => {
	it('start as Old Time, Reel, Jig, then Default', () => {
		const lib = emptyLibrary();
		expect(labels(lib)).toEqual(['Old Time', 'Reel', 'Jig']);
		const [old, reel, jig] = sortedProfiles(playbackOf(lib)).map((p) => p.settings);
		expect(old).toMatchObject({ lilt: 1.5, accent: -20, attack: 0 });
		expect(reel).toMatchObject({ lilt: 1, accent: 30, attack: 10 });
		expect(jig).toMatchObject({ lilt: 1.1, accent: 30, attack: 10 });
		// Default: as written. All on the default instrument, times through and chords.
		expect(playbackOf(lib).default).toEqual(AS_WRITTEN);
		for (const p of [old, reel, jig])
			expect(p).toMatchObject({ instrument: 'fiddle', timesThrough: 2, chords: false });
	});

	it('are keyed by tag key and fit in Automerge', () => {
		const lib = emptyLibrary();
		expect(Object.keys(playbackOf(lib).profiles).sort()).toEqual(['jig', 'old time', 'reel']);
		const doc = Automerge.from(lib as unknown as Record<string, unknown>);
		expect(Automerge.toJS(doc)).toEqual(lib);
	});

	it('reset the feel to the seeded one, or as written for other tags', () => {
		expect(seededFeel('reel')).toEqual({ lilt: 1, accent: 30, attack: 10 });
		expect(seededFeel('old time')).toEqual({ lilt: 1.5, accent: -20, attack: 0 });
		expect(seededFeel('hornpipe')).toEqual({ lilt: 1, accent: 0, attack: 0 });
		expect(seededFeel(undefined)).toEqual({ lilt: 1, accent: 0, attack: 0 });
	});
});

describe('migration', () => {
	const v1 = (): Library => {
		const lib = emptyLibrary();
		delete lib.settings.playback;
		lib.schemaVersion = 1;
		return lib;
	};

	it('seeds the profiles in a doc that has none', () => {
		const lib = v1();
		migrate(lib);
		expect(lib.schemaVersion).toBe(SCHEMA_VERSION);
		expect(lib.settings.playback).toEqual(seedPlayback());
		// Idempotent.
		migrate(lib);
		expect(lib.settings.playback).toEqual(seedPlayback());
	});

	it('imports this device’s old instrument, times through and chords', () => {
		const legacy = parseLegacySynthOptions(
			JSON.stringify({
				instrument: 'whistle',
				timesThrough: 3,
				chords: true,
				humanize: { style: 'oldtime', lilt: 20, accent: 20, attack: 15 }
			})
		);
		expect(legacy).toEqual({ instrument: 'whistle', timesThrough: 3, chords: true });
		const lib = v1();
		migrate(lib, legacy);
		expect(playbackOf(lib).default).toEqual({ ...AS_WRITTEN, ...legacy });
		for (const p of sortedProfiles(playbackOf(lib)))
			expect(p.settings).toMatchObject({ instrument: 'whistle', timesThrough: 3, chords: true });
	});

	it('ignores the old options once another device has added profiles', () => {
		const lib = v1();
		lib.settings.playback = seedPlayback({ instrument: 'flute' });
		migrate(lib, { instrument: 'whistle', timesThrough: 4 });
		expect(playbackOf(lib).default.instrument).toBe('flute');
		expect(playbackOf(lib).default.timesThrough).toBe(2);
		// …and a doc already at the current version is never re-seeded.
		const current = emptyLibrary();
		updateProfile(current, undefined, { instrument: 'piano' });
		migrate(current, { instrument: 'whistle' });
		expect(playbackOf(current).default.instrument).toBe('piano');
	});

	it('drops nonsense in the old options', () => {
		expect(parseLegacySynthOptions(null)).toEqual({});
		expect(parseLegacySynthOptions('{oops')).toEqual({});
		expect(
			parseLegacySynthOptions(JSON.stringify({ instrument: 'banjo', timesThrough: 9, chords: 1 }))
		).toEqual({});
	});

	it('merges two devices migrating at once into the same profiles', () => {
		const base = Automerge.from(
			v1() as unknown as Record<string, unknown>
		) as Automerge.Doc<Library>;
		const a = Automerge.change(Automerge.clone(base), (d) => migrate(d));
		const b = Automerge.change(Automerge.clone(base), (d) => migrate(d));
		const merged = Automerge.toJS(Automerge.merge(a, b)) as Library;
		expect(labels(merged)).toEqual(['Old Time', 'Reel', 'Jig']);
	});
});

describe('resolving a piece’s profile', () => {
	it('uses the first profile in the profiles’ order whose tag the piece has', () => {
		const lib = emptyLibrary();
		const reel = piece(lib, ['Reel']);
		const oldReel = piece(lib, ['Reel', 'Old Time']);
		const jig = piece(lib, ['Jig', 'favourite']);
		expect(profileFor(lib, lib.pieces[reel]).label).toBe('Reel');
		expect(profileFor(lib, lib.pieces[oldReel]).label).toBe('Old Time');
		expect(profileFor(lib, lib.pieces[jig]).label).toBe('Jig');
	});

	it('ignores the order of the piece’s own tags', () => {
		// The piece's tags in the reverse of the profiles' order, either way round: Old Time wins.
		expect(matchProfile(seedPlayback(), ['Jig', 'Reel', 'Old Time']).label).toBe('Old Time');
		expect(matchProfile(seedPlayback(), ['Old Time', 'Reel', 'Jig']).label).toBe('Old Time');
		expect(matchProfile(seedPlayback(), ['Jig', 'Reel']).label).toBe('Reel');
		const lib = emptyLibrary();
		const id = createPiece(lib);
		// Stored in reverse order (map insertion order) too.
		lib.pieces[id].tags = { Jig: true, Reel: true, 'Old Time': true };
		expect(profileFor(lib, lib.pieces[id]).label).toBe('Old Time');
	});

	it('falls back to Default', () => {
		const lib = emptyLibrary();
		const id = piece(lib, ['Hornpipe']);
		const p = profileFor(lib, lib.pieces[id]);
		expect(p.key).toBeUndefined();
		expect(p.label).toBe('Default');
		expect(profileFor(lib, undefined).label).toBe('Default');
	});

	it('matches tags in any case and spacing', () => {
		const lib = emptyLibrary();
		const id = piece(lib, ['  old   TIME ']);
		expect(profileFor(lib, lib.pieces[id]).label).toBe('Old Time');
		expect(matchProfile(seedPlayback(), ['JIG']).label).toBe('Jig');
	});

	it('gives a Part its Tune’s tags too', () => {
		const lib = emptyLibrary();
		const tune = piece(lib, ['Reel'], 'tune', 1);
		const part = piece(lib, [], 'part', 2);
		linkPieces(lib, tune, part);
		expect(profileFor(lib, lib.pieces[part]).label).toBe('Reel');
		// Its own tags count as well; the profiles' order decides.
		const own = piece(lib, ['Old Time'], 'part', 3);
		linkPieces(lib, tune, own);
		expect(profileFor(lib, lib.pieces[own]).label).toBe('Old Time');
		// Only Parts inherit: a Set's tags don't reach its tunes.
		const set = piece(lib, ['Jig'], 'set', 4);
		const inSet = piece(lib, [], 'tune', 5);
		linkPieces(lib, set, inSet);
		expect(profileFor(lib, lib.pieces[inSet]).label).toBe('Default');
	});

	it('counts extra tags (the picker’s type tag) as the piece’s', () => {
		const lib = emptyLibrary();
		const blank = piece(lib, []);
		expect(profileFor(lib, lib.pieces[blank], ['Reel']).label).toBe('Reel');
		// The piece's own tags still win when their profile comes first.
		const old = piece(lib, ['Old Time']);
		expect(profileFor(lib, lib.pieces[old], ['Reel']).label).toBe('Old Time');
		expect(profileFor(lib, undefined, ['Jig']).label).toBe('Jig');
	});

	it('makes render options, with a recording’s instrument override', () => {
		const lib = emptyLibrary();
		const id = piece(lib, ['Reel']);
		const p = lib.pieces[id];
		expect(synthOptionsFor(lib, p)).toEqual({
			instrument: 'fiddle',
			timesThrough: 2,
			chords: false,
			humanize: { lilt: 1, accent: 30, attack: 10 }
		});
		expect(synthOptionsFor(lib, p, { instrument: 'flute' }).instrument).toBe('flute');
		expect(synthOptionsFor(lib, p, { instrument: 'banjo' }).instrument).toBe('fiddle');
	});

	it('works on a doc from before profiles (the seeded ones)', () => {
		const lib = emptyLibrary();
		delete lib.settings.playback;
		const id = piece(lib, ['jig']);
		expect(profileFor(lib, lib.pieces[id]).label).toBe('Jig');
	});
});

describe('editing profiles', () => {
	it('adds a tag’s profile last before Default, from Default’s instrument', () => {
		const lib = emptyLibrary();
		piece(lib, ['Hornpipe']);
		updateProfile(lib, undefined, { instrument: 'accordion', accent: 50 });
		expect(addProfile(lib, 'hornpipe')).toBe('hornpipe');
		expect(labels(lib)).toEqual(['Old Time', 'Reel', 'Jig', 'Hornpipe']);
		// The library's spelling; the Default's instrument; as written.
		expect(playbackOf(lib).profiles.hornpipe).toMatchObject({
			tag: 'Hornpipe',
			instrument: 'accordion',
			lilt: 1,
			accent: 0,
			attack: 0
		});
		// Not twice, not blank, not "Default".
		expect(addProfile(lib, 'HORNPIPE')).toBeUndefined();
		expect(addProfile(lib, '  ')).toBeUndefined();
		expect(addProfile(lib, 'default')).toBeUndefined();
		// A removed seeded tag comes back with its seeded feel.
		removeProfile(lib, 'reel');
		addProfile(lib, 'Reel');
		expect(playbackOf(lib).profiles.reel).toMatchObject({ accent: 30, attack: 10 });
	});

	it('removes a profile, with undo', () => {
		const lib = emptyLibrary();
		const removed = removeProfile(lib, 'reel');
		expect(labels(lib)).toEqual(['Old Time', 'Jig']);
		expect(removeProfile(lib, 'reel')).toBeUndefined();
		restoreProfile(lib, 'reel', removed!);
		expect(labels(lib)).toEqual(['Old Time', 'Reel', 'Jig']);
	});

	it('reorders', () => {
		const lib = emptyLibrary();
		expect(moveProfile(lib, 'jig', -1)).toBe(true);
		expect(labels(lib)).toEqual(['Old Time', 'Jig', 'Reel']);
		expect(moveProfile(lib, 'jig', -5)).toBe(true);
		expect(labels(lib)).toEqual(['Jig', 'Old Time', 'Reel']);
		expect(moveProfile(lib, 'jig', -1)).toBe(false);
		moveProfile(lib, 'old time', 1);
		expect(labels(lib)).toEqual(['Jig', 'Reel', 'Old Time']);
		// A reel tagged Old Time now plays as a Reel.
		const id = piece(lib, ['Reel', 'Old Time']);
		expect(profileFor(lib, lib.pieces[id]).label).toBe('Reel');
	});

	it('writes only the settings that change, normalized', () => {
		const lib = emptyLibrary();
		expect(updateProfile(lib, 'reel', { accent: 30 })).toBe(false);
		expect(updateProfile(lib, 'reel', { lilt: 9, accent: 500, timesThrough: 3 })).toBe(true);
		expect(playbackOf(lib).profiles.reel).toMatchObject({ lilt: 2, accent: 100, timesThrough: 3 });
		expect(updateProfile(lib, 'nope', { accent: 1 })).toBe(false);
		updateProfile(lib, undefined, { chords: true });
		expect(playbackOf(lib).default.chords).toBe(true);
	});

	it('merges concurrent edits to different settings of a profile', () => {
		const base = Automerge.from(
			emptyLibrary() as unknown as Record<string, unknown>
		) as Automerge.Doc<Library>;
		const a = Automerge.change(
			Automerge.clone(base),
			(d) => void updateProfile(d, 'reel', { lilt: 1.2 })
		);
		const b = Automerge.change(
			Automerge.clone(base),
			(d) => void updateProfile(d, 'reel', { instrument: 'flute' })
		);
		const merged = Automerge.toJS(Automerge.merge(a, b)) as Library;
		expect(playbackOf(merged).profiles.reel).toMatchObject({ lilt: 1.2, instrument: 'flute' });
	});

	it('normalizes synced nonsense', () => {
		expect(
			normalizeProfile({ instrument: 'banjo', timesThrough: 0, lilt: 'x', accent: 1e9 })
		).toEqual({ ...AS_WRITTEN, accent: 100 });
		expect(SEED_PROFILES.map((s) => s.tag)).toEqual(['Old Time', 'Reel', 'Jig']);
	});
});
