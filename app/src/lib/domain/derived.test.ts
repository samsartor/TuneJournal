import { describe, expect, it } from 'vitest';
import * as Automerge from '@automerge/automerge';
import { emptyLibrary } from './library';
import { addTag, createPiece, logPractice, softDelete, updatePiece, type PiecePatch } from './ops';
import {
	activeFilterCount,
	buildIndex,
	foldText,
	getIndex,
	listPieces,
	matchesSearch,
	sortPieces
} from './derived';
import type { Library, ListSettings, PieceKind } from './types';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 100 * DAY;

const allKinds: Record<PieceKind, boolean> = {
	tune: false,
	set: false,
	part: false,
	session: false
};

function settings(patch: Partial<ListSettings> = {}): ListSettings {
	return { sort: 'title', descending: false, kinds: { ...allKinds }, ...patch };
}

function add(
	lib: Library,
	title: string | undefined,
	opts: PiecePatch & { tags?: string[]; practiced?: number[]; created?: number } = {}
) {
	const { tags = [], practiced = [], created = 0, ...patch } = opts;
	const id = createPiece(lib, { title, now: created });
	updatePiece(lib, id, patch, created);
	for (const t of tags) addTag(lib, id, t, created);
	for (const at of practiced) logPractice(lib, id, { now: at });
	return id;
}

function fixture() {
	const lib = emptyLibrary();
	const ids = {
		cooleys: add(lib, 'Cooley’s', {
			tags: ['Reel', 'Session'],
			key: 'Edor',
			skill: 4,
			favorite: true,
			practiced: [NOW - 2 * DAY, NOW - 30 * DAY],
			created: 1
		}),
		kesh: add(lib, 'The Kesh', {
			tags: ['Jig', 'session'],
			key: 'G',
			skill: 2,
			practiced: [NOW - 20 * DAY],
			created: 2
		}),
		butterfly: add(lib, 'The Butterfly', { tags: ['Slip Jig'], key: 'Em', created: 3 }),
		set: add(lib, 'Kesh set', { kind: 'set', tags: ['Session'], key: 'G', created: 4 }),
		untitled: add(lib, undefined, { created: 5 }),
		gone: add(lib, 'Deleted reel', { tags: ['Reel'], created: 6 })
	};
	softDelete(lib, ids.gone, 7);
	return { lib, ids };
}

const titles = (lib: Library, s: ListSettings, query = '') =>
	listPieces(buildIndex(lib), { settings: s, query, now: NOW }).map((p) => p.title ?? null);

describe('buildIndex', () => {
	it('lists only live pieces', () => {
		const { lib, ids } = fixture();
		const index = buildIndex(lib);
		expect(index.live.map((p) => p.id)).not.toContain(ids.gone);
		expect(index.live).toHaveLength(5);
	});

	it('computes practice stats', () => {
		const { lib, ids } = fixture();
		const index = buildIndex(lib);
		expect(index.stats(lib.pieces[ids.cooleys])).toEqual({
			timesPracticed: 2,
			lastPracticed: NOW - 2 * DAY
		});
		expect(index.stats(lib.pieces[ids.butterfly])).toEqual({ timesPracticed: 0 });
		expect(index.effectivePractice(lib.pieces[ids.cooleys]).map((e) => e.at)).toEqual([
			NOW - 2 * DAY,
			NOW - 30 * DAY
		]);
	});

	it('counts tag usage case-insensitively, most used first, ignoring deleted pieces', () => {
		const { lib } = fixture();
		expect(buildIndex(lib).tags).toEqual([
			{ tag: 'Session', count: 3 },
			{ tag: 'Jig', count: 1 },
			{ tag: 'Reel', count: 1 },
			{ tag: 'Slip Jig', count: 1 }
		]);
	});

	it('collects keys from tunes and parts only', () => {
		const { lib } = fixture();
		expect(buildIndex(lib).keys).toEqual(['E dorian', 'E minor', 'G major']);
	});

	it('shows one spelling per tag after a merge brought in two', () => {
		const lib = emptyLibrary();
		const id = createPiece(lib);
		lib.pieces[id].tags = { reel: true, Reel: true, Jig: true };
		const index = buildIndex(lib);
		expect(index.tagsOf(lib.pieces[id])).toEqual(['Jig', 'Reel']);
		expect(index.tags).toEqual([
			{ tag: 'Jig', count: 1 },
			{ tag: 'Reel', count: 1 }
		]);
	});

	it('effective skill and key are the piece’s own for now', () => {
		const { lib, ids } = fixture();
		const index = buildIndex(lib);
		expect(index.effectiveSkill(lib.pieces[ids.kesh])).toBe(2);
		expect(index.effectiveKey(lib.pieces[ids.kesh])).toBe('G major');
		expect(index.effectiveKey(lib.pieces[ids.set])).toBeUndefined();
	});
});

describe('getIndex', () => {
	it('memoizes per Automerge snapshot', () => {
		let doc = Automerge.from(
			emptyLibrary() as unknown as Record<string, unknown>
		) as unknown as Automerge.Doc<Library>;
		const first = getIndex(doc);
		expect(getIndex(doc)).toBe(first);
		doc = Automerge.change(doc, (d) => void createPiece(d, { title: 'New' }));
		const second = getIndex(doc);
		expect(second).not.toBe(first);
		expect(second.live.map((p) => p.title)).toEqual(['New']);
	});
});

describe('search', () => {
	it('folds case, accents and apostrophes', () => {
		expect(foldText('  Cooley’s Réel! ')).toBe('cooleys reel');
	});

	it('needs every word in the title', () => {
		const { lib } = fixture();
		expect(titles(lib, settings(), 'kesh')).toEqual(['Kesh set', 'The Kesh']);
		expect(titles(lib, settings(), 'the kesh')).toEqual(['The Kesh']);
		expect(titles(lib, settings(), "cooley's")).toEqual(['Cooley’s']);
		expect(titles(lib, settings(), 'nothing')).toEqual([]);
	});

	it('matches everything for a blank query, but not untitled pieces for a real one', () => {
		const lib = emptyLibrary();
		const id = createPiece(lib);
		expect(matchesSearch(lib.pieces[id], '  ')).toBe(true);
		expect(matchesSearch(lib.pieces[id], 'untitled')).toBe(false);
	});
});

describe('filter', () => {
	const { lib } = fixture();

	it('by kind, with no kind meaning all', () => {
		expect(titles(lib, settings({ kinds: { ...allKinds, set: true } }))).toEqual(['Kesh set']);
		expect(titles(lib, settings())).toHaveLength(5);
	});

	it('by tags, any or all', () => {
		expect(titles(lib, settings({ tags: { reel: true, jig: true } }))).toEqual([
			'Cooley’s',
			'The Kesh'
		]);
		expect(titles(lib, settings({ tags: { SESSION: true, Jig: true }, tagMode: 'all' }))).toEqual([
			'The Kesh'
		]);
	});

	it('by skill range, counting unrated as 1', () => {
		expect(titles(lib, settings({ skillMin: 2, skillMax: 4 }))).toEqual(['Cooley’s', 'The Kesh']);
		expect(titles(lib, settings({ skillMax: 1 }))).toEqual(['Kesh set', 'The Butterfly', null]);
		expect(
			titles(lib, settings({ unratedOnly: true, kinds: { ...allKinds, tune: true } }))
		).toEqual(['The Butterfly', null]);
	});

	it('by key, ignoring sets', () => {
		expect(titles(lib, settings({ key: 'G major' }))).toEqual(['The Kesh']);
	});

	it('by favorites', () => {
		expect(titles(lib, settings({ favoritesOnly: true }))).toEqual(['Cooley’s']);
	});

	it('by practiced within or not within N days', () => {
		expect(titles(lib, settings({ practiced: { within: true, days: 7 } }))).toEqual(['Cooley’s']);
		expect(titles(lib, settings({ practiced: { within: true, days: 20 } }))).toEqual([
			'Cooley’s',
			'The Kesh'
		]);
		expect(titles(lib, settings({ practiced: { within: false, days: 7 } }))).toEqual([
			'Kesh set',
			'The Butterfly',
			'The Kesh',
			null
		]);
	});

	it('counts active filters', () => {
		expect(activeFilterCount(settings())).toBe(0);
		expect(
			activeFilterCount(
				settings({ tags: { a: true }, skillMin: 2, favoritesOnly: true, key: 'D major' })
			)
		).toBe(4);
	});
});

describe('sort', () => {
	const { lib } = fixture();
	const sorted = (sort: ListSettings['sort'], descending = false) =>
		titles(lib, settings({ sort, descending }));

	it('by title, untitled last either way', () => {
		expect(sorted('title')).toEqual(['Cooley’s', 'Kesh set', 'The Butterfly', 'The Kesh', null]);
		expect(sorted('title', true)).toEqual([
			'The Kesh',
			'The Butterfly',
			'Kesh set',
			'Cooley’s',
			null
		]);
	});

	it('by created and modified', () => {
		expect(sorted('created')).toEqual(['Cooley’s', 'The Kesh', 'The Butterfly', 'Kesh set', null]);
		expect(sorted('modified', true)).toEqual([
			null,
			'Kesh set',
			'The Butterfly',
			'The Kesh',
			'Cooley’s'
		]);
	});

	it('by last practiced, never practiced counting as oldest', () => {
		expect(sorted('lastPracticed')).toEqual([
			'Kesh set',
			'The Butterfly',
			null,
			'The Kesh',
			'Cooley’s'
		]);
		expect(sorted('lastPracticed', true).slice(0, 2)).toEqual(['Cooley’s', 'The Kesh']);
	});

	it('by times practiced and skill', () => {
		expect(sorted('timesPracticed', true).slice(0, 2)).toEqual(['Cooley’s', 'The Kesh']);
		expect(sorted('skill', true).slice(0, 2)).toEqual(['Cooley’s', 'The Kesh']);
		expect(sorted('skill').slice(-2)).toEqual(['The Kesh', 'Cooley’s']);
	});

	it('sorts in place and returns the same array', () => {
		const index = buildIndex(lib);
		const pieces = [...index.live];
		expect(sortPieces(index, pieces, 'title', false)).toBe(pieces);
	});
});
