import { describe, expect, it } from 'vitest';
import * as Automerge from '@automerge/automerge';
import { buildIndex } from './derived';
import { emptyLibrary } from './library';
import { addTag, createPiece, logPractice, updatePiece } from './ops';
import {
	MergeError,
	linkId,
	linkPieces,
	mergePieces,
	resolvePiece,
	sortLinks,
	unlinkPieces
} from './relations';
import { linkTheSessionTune } from './thesession';
import type { ClipId, Library, PieceId, SourceId } from './types';

interface Harness {
	readonly lib: Library;
	change<T>(fn: (lib: Library) => T): T;
}

function plain(): Harness {
	const lib = emptyLibrary();
	return { lib, change: (fn) => fn(lib) };
}

function automerge(): Harness {
	let doc = Automerge.from(
		emptyLibrary() as unknown as Record<string, unknown>
	) as unknown as Library;
	return {
		get lib() {
			return doc;
		},
		change(fn) {
			let result!: ReturnType<typeof fn>;
			doc = Automerge.change(doc as unknown as Automerge.Doc<Library>, (d) => {
				result = fn(d);
			}) as unknown as Library;
			return result;
		}
	};
}

function hasUndefined(value: unknown): boolean {
	if (value === undefined) return true;
	if (value === null || typeof value !== 'object') return false;
	return Object.values(value).some(hasUndefined);
}

const children = (lib: Library, parent: PieceId) =>
	sortLinks(Object.values(lib.links).filter((l) => l.parent === parent)).map((l) => l.child);

describe.each([
	['plain object', plain],
	['Automerge doc', automerge]
])('relations on a %s', (_, make) => {
	function pieces(n: number, h = make()) {
		const ids = h.change((l) =>
			Array.from({ length: n }, (_, i) =>
				createPiece(l, { title: `P${i}`, now: 1000 + i, id: `p${i}` as PieceId })
			)
		);
		return { h, ids };
	}

	describe('linkPieces', () => {
		it('appends children in order with fractional keys', () => {
			const { h, ids } = pieces(4);
			const [set, a, b, c] = ids;
			h.change((l) => {
				linkPieces(l, set, a);
				linkPieces(l, set, b);
				linkPieces(l, set, c);
			});
			expect(children(h.lib, set)).toEqual([a, b, c]);
			expect(h.lib.links[linkId(set, a)]).toMatchObject({ parent: set, child: a });
		});

		it('is idempotent, keeps the position, and refuses self-links', () => {
			const { h, ids } = pieces(3);
			const [set, a, b] = ids;
			h.change((l) => {
				linkPieces(l, set, a);
				linkPieces(l, set, b);
			});
			const order = h.lib.links[linkId(set, a)].order;
			h.change((l) => linkPieces(l, set, a));
			expect(h.lib.links[linkId(set, a)].order).toBe(order);
			expect(Object.keys(h.lib.links)).toHaveLength(2);
			expect(() => h.change((l) => linkPieces(l, set, set))).toThrow(RangeError);
		});

		it('unlinks', () => {
			const { h, ids } = pieces(2);
			h.change((l) => linkPieces(l, ids[0], ids[1]));
			expect(h.change((l) => unlinkPieces(l, ids[0], ids[1]))).toBe(true);
			expect(h.change((l) => unlinkPieces(l, ids[0], ids[1]))).toBe(false);
			expect(h.lib.links).toEqual({});
		});
	});

	describe('mergePieces', () => {
		function setup() {
			const { h, ids } = pieces(4);
			const [survivor, loser, set, part] = ids;
			h.change((l) => {
				updatePiece(l, survivor, { title: 'Cooley’s', skill: 2, key: 'Edor' }, 1100);
				updatePiece(l, loser, { title: 'Cooleys', skill: 4, favorite: true }, 1100);
				updatePiece(l, loser, { description: 'From the loser', firstNotes: 'D2|EBBA' }, 1100);
				addTag(l, survivor, 'Reel');
				addTag(l, loser, 'reel');
				addTag(l, loser, 'Session');
				logPractice(l, survivor, { now: 3000 });
				logPractice(l, loser, { now: 2000, via: 'card' });
				logPractice(l, loser, { now: 4000 });
				l.pieces[survivor].external = { thesession: { tuneId: 1 } };
				l.pieces[loser].external = { thesession: { tuneId: 1, settingId: 12342 } };
				l.sources['s1' as SourceId] = {
					id: 's1' as SourceId,
					provider: 'url',
					url: 'https://example.com',
					addedAt: 1
				};
				l.pieces[loser].clips['c1' as ClipId] = {
					id: 'c1' as ClipId,
					sourceId: 's1' as SourceId,
					order: 'a0',
					addedAt: 1
				};
				linkPieces(l, set, loser);
				linkPieces(l, set, survivor);
				linkPieces(l, loser, part);
			});
			return { h, survivor, loser, set, part };
		}

		it('unions everything into the survivor and tombstones the loser', () => {
			const { h, survivor, loser, set, part } = setup();
			h.change((l) => mergePieces(l, survivor, loser, { now: 9000 }));
			const s = h.lib.pieces[survivor];
			expect(s).toMatchObject({
				title: 'Cooley’s',
				kind: 'tune',
				// Filled from the loser because the survivor had none.
				description: 'From the loser',
				firstNotes: 'D2|EBBA',
				key: 'E dorian',
				favorite: true,
				skill: 4,
				modifiedAt: 9000,
				external: { thesession: { tuneId: 1, settingId: 12342 } }
			});
			expect(Object.keys(s.tags).sort()).toEqual(['Reel', 'Session']);
			expect(s.practice.map((p) => p.at)).toEqual([2000, 3000, 4000]);
			expect(s.practice[0].via).toBe('card');
			expect(Object.keys(s.clips)).toEqual(['c1']);

			expect(h.lib.pieces[loser]).toMatchObject({ mergedInto: survivor, deletedAt: 9000 });
			// The set's two links collapse into one; the loser's child moves over.
			expect(Object.keys(h.lib.links).sort()).toEqual(
				[linkId(set, survivor), linkId(survivor, part)].sort()
			);
			expect(resolvePiece(h.lib, loser)?.id).toBe(survivor);
			expect(hasUndefined(h.lib)).toBe(false);
		});

		it('takes picked fields from either piece', () => {
			const { h, survivor, loser } = setup();
			h.change((l) => updatePiece(l, survivor, { description: 'Mine' }));
			h.change((l) =>
				mergePieces(l, survivor, loser, {
					fields: { title: loser, description: survivor, key: loser }
				})
			);
			const s = h.lib.pieces[survivor];
			expect(s.title).toBe('Cooleys');
			expect(s.description).toBe('Mine');
			// The loser had no key, so picking it clears the survivor's.
			expect('key' in s).toBe(false);
		});

		it('drops a link between the two pieces instead of making a self-link', () => {
			const { h, ids } = pieces(2);
			h.change((l) => linkPieces(l, ids[0], ids[1]));
			h.change((l) => mergePieces(l, ids[0], ids[1]));
			expect(h.lib.links).toEqual({});
		});

		it('merges several losers, follows redirects, and refuses self-merges', () => {
			const { h, ids } = pieces(4);
			const [a, b, c, d] = ids;
			h.change((l) => mergePieces(l, a, [b, c]));
			expect(h.lib.pieces[b].mergedInto).toBe(a);
			expect(h.lib.pieces[c].mergedInto).toBe(a);
			// Merging into a merged-away piece lands on its survivor.
			h.change((l) => mergePieces(l, b, d));
			expect(h.lib.pieces[d].mergedInto).toBe(a);
			expect(() => h.change((l) => mergePieces(l, a, a))).toThrow(MergeError);
			expect(() => h.change((l) => mergePieces(l, b, a))).toThrow(MergeError);
			// Merging the same pair again changes nothing.
			const before = JSON.stringify(h.lib);
			h.change((l) => mergePieces(l, a, b, { now: 1 }));
			expect(JSON.stringify(h.lib)).toBe(before);
		});

		it('dedupes the shared thesession clip', () => {
			const { h, ids } = pieces(2);
			h.change((l) => {
				linkTheSessionTune(l, ids[0], { tuneId: 1, name: 'Cooley’s', type: 'reel' });
				linkTheSessionTune(l, ids[1], { tuneId: 1, name: 'Cooley’s', type: 'reel' });
				mergePieces(l, ids[0], ids[1]);
			});
			expect(Object.keys(h.lib.pieces[ids[0]].clips)).toEqual(['thesession:tune:1']);
		});
	});
});

describe('resolvePiece', () => {
	it('stops at cycles and missing targets', () => {
		const lib = emptyLibrary();
		const a = createPiece(lib, { id: 'a' as PieceId });
		const b = createPiece(lib, { id: 'b' as PieceId });
		lib.pieces[a].mergedInto = b;
		lib.pieces[b].mergedInto = a;
		expect(['a', 'b']).toContain(resolvePiece(lib, a)?.id);
		lib.pieces[b].mergedInto = 'gone' as PieceId;
		expect(resolvePiece(lib, a)?.id).toBe(b);
		expect(resolvePiece(lib, 'nope' as PieceId)).toBeUndefined();
	});
});

describe('concurrent merges and links (Automerge)', () => {
	type Doc = Automerge.Doc<Library>;
	const change = (doc: Doc, fn: (l: Library) => void) =>
		Automerge.change(doc, (d) => fn(d as unknown as Library));

	function base() {
		let doc = Automerge.from(
			emptyLibrary() as unknown as Record<string, unknown>
		) as unknown as Doc;
		doc = change(doc, (l) => {
			for (const id of ['set', 'keep', 'lose']) createPiece(l, { id: id as PieceId, title: id });
			linkPieces(l, 'set' as PieceId, 'lose' as PieceId);
			logPractice(l, 'lose' as PieceId, { now: 5 });
		});
		return doc;
	}
	const set = 'set' as PieceId;
	const keep = 'keep' as PieceId;
	const lose = 'lose' as PieceId;

	it('a merge on one device and a direct link on another give one link', () => {
		const doc = base();
		const one = change(Automerge.clone(doc), (l) => mergePieces(l, keep, lose));
		const two = change(Automerge.clone(doc), (l) => linkPieces(l, set, keep));
		const merged = Automerge.merge(one, two) as unknown as Library;
		expect(Object.keys(merged.links)).toEqual([linkId(set, keep)]);
		const index = buildIndex(merged);
		expect(index.children(merged.pieces[set]).map((r) => r.piece.id)).toEqual([keep]);
	});

	it('the same merge on two devices converges without duplicates', () => {
		const doc = base();
		const one = change(Automerge.clone(doc), (l) => mergePieces(l, keep, lose, { now: 10 }));
		const two = change(Automerge.clone(doc), (l) => mergePieces(l, keep, lose, { now: 20 }));
		const merged = Automerge.merge(one, two) as unknown as Library;
		expect(Object.keys(merged.links)).toEqual([linkId(set, keep)]);
		expect(merged.pieces[lose].mergedInto).toBe(keep);
		// Both devices copied the practice entry; the index shows it once.
		const index = buildIndex(merged);
		expect(index.effectivePractice(merged.pieces[keep]).map((e) => e.at)).toEqual([5]);
	});

	it('a link added to the loser while it was merged elsewhere follows the redirect', () => {
		const doc = base();
		const one = change(Automerge.clone(doc), (l) => mergePieces(l, keep, lose));
		const two = change(Automerge.clone(doc), (l) => {
			createPiece(l, { id: 'other' as PieceId });
			linkPieces(l, 'other' as PieceId, lose);
		});
		const merged = Automerge.merge(one, two) as unknown as Library;
		const index = buildIndex(merged);
		expect(
			index
				.parents(merged.pieces[keep])
				.map((r) => r.piece.id)
				.sort()
		).toEqual(['other', 'set']);
	});
});
