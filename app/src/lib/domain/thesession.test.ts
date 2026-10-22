import { describe, expect, it } from 'vitest';
import * as Automerge from '@automerge/automerge';
import { buildIndex } from './derived';
import { emptyLibrary } from './library';
import { addTag, createPiece, updatePiece } from './ops';
import { updateClip } from './recordings';
import { linkId, sortLinks } from './relations';
import {
	applyTheSessionSetting,
	linkTheSessionTune,
	pieceForSet,
	piecesWithTune,
	promoteTheSessionSet,
	typeTag,
	unlinkTheSession,
	type TheSessionSetInfo
} from './thesession';
import type { ClipId, Library, PieceId } from './types';

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

const COOLEYS = { tuneId: 1, name: "Cooley's", type: 'reel' };

describe('typeTag', () => {
	it('capitalises thesession types', () => {
		expect(typeTag('reel')).toBe('Reel');
		expect(typeTag('slip jig')).toBe('Slip Jig');
		expect(typeTag('three-two')).toBe('Three-Two');
		expect(typeTag('barndance')).toBe('Barndance');
		expect(typeTag('strathspey')).toBe('Strathspey');
		expect(typeTag('some new type')).toBe('Some New Type');
		expect(typeTag('  ')).toBeUndefined();
	});
});

describe.each([
	['plain object', plain],
	['Automerge doc', automerge]
])('thesession ops on a %s', (_, make) => {
	function withPiece(title?: string) {
		const h = make();
		const id = h.change((l) => createPiece(l, { now: 1000, title }));
		return { h, id, piece: () => h.lib.pieces[id] };
	}

	describe('linkTheSessionTune', () => {
		it('fills a blank title, type tag, tune id and a link-only source', () => {
			const { h, id, piece } = withPiece();
			h.change((l) => linkTheSessionTune(l, id, COOLEYS, { now: 2000 }));
			expect(piece()).toMatchObject({
				title: "Cooley's",
				tags: { Reel: true },
				external: { thesession: { tuneId: 1 } },
				modifiedAt: 2000
			});
			const clip = piece().clips['thesession:tune:1' as never];
			expect(clip).toMatchObject({ sourceId: 'thesession:tune:1', addedAt: 2000 });
			expect(h.lib.sources[clip.sourceId]).toEqual({
				id: 'thesession:tune:1',
				provider: 'thesession',
				url: 'https://thesession.org/tunes/1',
				externalId: '1',
				addedAt: 2000
			});
			expect(hasUndefined(h.lib)).toBe(false);
		});

		it('keeps a different title unless told to replace it', () => {
			const { h, id, piece } = withPiece('Cooleys reel');
			h.change((l) => linkTheSessionTune(l, id, COOLEYS));
			expect(piece().title).toBe('Cooleys reel');
			h.change((l) => linkTheSessionTune(l, id, COOLEYS, { replaceTitle: true }));
			expect(piece().title).toBe("Cooley's");
			// Linking twice doesn't add a second clip.
			expect(Object.keys(piece().clips)).toHaveLength(1);
		});

		it('reuses the casing of an existing tag', () => {
			const h = make();
			const [a, b] = h.change((l) => [createPiece(l, { now: 1 }), createPiece(l, { now: 2 })]);
			h.change((l) => addTag(l, a, 'slip JIG'));
			h.change((l) =>
				linkTheSessionTune(l, b, { tuneId: 5, name: 'The Butterfly', type: 'slip jig' })
			);
			expect(Object.keys(h.lib.pieces[b].tags)).toEqual(['slip JIG']);
		});

		it('relinking to another tune drops the old setting and link', () => {
			const { h, id, piece } = withPiece();
			h.change((l) => {
				linkTheSessionTune(l, id, COOLEYS);
				applyTheSessionSetting(l, id, { settingId: 12342, key: 'Eminor' });
				linkTheSessionTune(l, id, { tuneId: 55, name: 'The Kesh', type: 'jig' });
			});
			expect(piece().external).toEqual({ thesession: { tuneId: 55 } });
			expect(Object.keys(piece().clips)).toEqual(['thesession:tune:55']);
			expect(Object.keys(piece().tags).sort()).toEqual(['Jig', 'Reel']);
		});
	});

	describe('applyTheSessionSetting', () => {
		const TUNE_CLIP = 'thesession:tune:1' as ClipId;

		it('stores the setting and writes key and first notes to the thesession recording', () => {
			const { h, id, piece } = withPiece();
			h.change((l) => linkTheSessionTune(l, id, COOLEYS));
			const clipId = h.change((l) =>
				applyTheSessionSetting(l, id, {
					settingId: 1,
					key: 'Edorian',
					firstNotes: 'D2 | EBBA B2 EB | B2 AB dBAG'
				})
			);
			expect(clipId).toBe(TUNE_CLIP);
			expect(piece().clips[TUNE_CLIP]).toMatchObject({
				key: 'E dorian',
				firstNotes: 'D2 | EBBA B2 EB | B2 AB dBAG'
			});
			expect(piece().external).toEqual({ thesession: { tuneId: 1, settingId: 1 } });
			// The piece keeps no key of its own; it inherits the recording's (PLAN.md §5).
			expect('key' in piece()).toBe(false);
			expect('firstNotes' in piece()).toBe(false);
			const index = buildIndex(h.lib);
			expect(index.effectiveKey(piece())).toBe('E dorian');
			expect(index.effectiveFirstNotes(piece())).toBe('D2 | EBBA B2 EB | B2 AB dBAG');
			expect(index.keyOf(piece())?.origin).toMatchObject({ from: 'clip', clip: { id: TUNE_CLIP } });
			expect(hasUndefined(h.lib)).toBe(false);
		});

		it('only fills the recording’s blanks unless overwrite is set, never the piece’s', () => {
			const { h, id, piece } = withPiece();
			h.change((l) => {
				updatePiece(l, id, { key: 'D major', firstNotes: 'ABC' });
				linkTheSessionTune(l, id, COOLEYS);
				updateClip(l, id, TUNE_CLIP, { key: 'A dorian' });
			});
			h.change((l) =>
				applyTheSessionSetting(l, id, { settingId: 2, key: 'Eminor', firstNotes: 'F|CG' })
			);
			expect(piece().clips[TUNE_CLIP]).toMatchObject({ key: 'A dorian', firstNotes: 'F|CG' });
			h.change((l) =>
				applyTheSessionSetting(l, id, { settingId: 3, key: 'Edor' }, { overwrite: true })
			);
			expect(piece().clips[TUNE_CLIP].key).toBe('E dorian');
			// The new setting has no first notes, so the old setting's are dropped.
			expect('firstNotes' in piece().clips[TUNE_CLIP]).toBe(false);
			expect(piece().external?.thesession?.settingId).toBe(3);
			// Values the piece already had (from the old autofill, say) stay as they are.
			expect(piece()).toMatchObject({ key: 'D major', firstNotes: 'ABC' });
		});

		it('re-adds a removed thesession recording, and only stores the id without a tune', () => {
			const { h, id, piece } = withPiece();
			h.change((l) => {
				linkTheSessionTune(l, id, COOLEYS);
				delete l.pieces[id].clips[TUNE_CLIP];
			});
			h.change((l) => applyTheSessionSetting(l, id, { settingId: 1, key: 'Edor' }));
			expect(piece().clips[TUNE_CLIP]).toMatchObject({ key: 'E dorian' });

			const other = withPiece();
			const result = other.h.change((l) =>
				applyTheSessionSetting(l, other.id, { settingId: 9, key: 'Edor' })
			);
			expect(result).toBeUndefined();
			expect(other.piece().external).toEqual({ thesession: { settingId: 9 } });
			expect(other.piece().clips).toEqual({});
		});
	});

	it('unlinkTheSession removes ids and the link but keeps user fields', () => {
		const { h, id, piece } = withPiece();
		h.change((l) => {
			linkTheSessionTune(l, id, COOLEYS);
			updatePiece(l, id, { key: 'E dorian' });
			applyTheSessionSetting(l, id, { settingId: 1, key: 'Edor' });
		});
		expect(h.change((l) => unlinkTheSession(l, id))).toBe(true);
		expect('external' in piece()).toBe(false);
		expect(piece().clips).toEqual({});
		expect(piece()).toMatchObject({ title: "Cooley's", key: 'E dorian', tags: { Reel: true } });
		expect(h.change((l) => unlinkTheSession(l, id))).toBe(false);
	});

	describe('promoteTheSessionSet', () => {
		const SET: TheSessionSetInfo = {
			setId: 153106,
			url: 'https://thesession.org/members/191000/sets/153106',
			tunes: [
				{ tuneId: 27, name: 'Drowsy Maggie', type: 'reel', settingId: 27, key: 'Edor' },
				{ tuneId: 55, name: 'The Kesh', type: 'jig', settingId: 55, key: 'Gmaj' },
				{ tuneId: 1, name: "Cooley's", type: 'reel', settingId: 1, key: 'Edor' }
			]
		};

		it('creates a Set, reuses known tunes and creates the rest, in order', () => {
			const { h, id: cooleys } = withPiece('My Cooley’s');
			h.change((l) => linkTheSessionTune(l, cooleys, COOLEYS));
			const result = h.change((l) => promoteTheSessionSet(l, SET, 5000));
			expect(result.existed).toBe(false);
			expect(result.created).toHaveLength(2);
			expect(result.tunes[2]).toBe(cooleys);

			const set = h.lib.pieces[result.setId];
			expect(set).toMatchObject({
				kind: 'set',
				title: "Drowsy Maggie / The Kesh / Cooley's",
				external: { thesession: { setId: 153106 } }
			});
			expect(Object.keys(set.clips)).toEqual(['thesession:set:153106']);
			const kids = sortLinks(Object.values(h.lib.links).filter((l) => l.parent === result.setId));
			expect(kids.map((l) => l.child)).toEqual(result.tunes);

			const kesh = h.lib.pieces[result.tunes[1]];
			expect(kesh).toMatchObject({
				kind: 'tune',
				title: 'The Kesh',
				tags: { Jig: true },
				external: { thesession: { tuneId: 55, settingId: 55 } }
			});
			// The set's key goes on the new tune's thesession recording, which the tune inherits.
			expect(kesh.clips['thesession:tune:55' as ClipId]).toMatchObject({ key: 'G major' });
			expect(buildIndex(h.lib).effectiveKey(kesh)).toBe('G major');
			// The existing piece keeps its own title.
			expect(h.lib.pieces[cooleys].title).toBe('My Cooley’s');
			expect(pieceForSet(h.lib, 153106)?.id).toBe(result.setId);
			expect(hasUndefined(h.lib)).toBe(false);

			const index = buildIndex(h.lib);
			expect(index.children(set).map((r) => r.piece.title)).toEqual([
				'Drowsy Maggie',
				'The Kesh',
				'My Cooley’s'
			]);
			expect(index.parents(h.lib.pieces[cooleys]).map((r) => r.piece.id)).toEqual([result.setId]);
		});

		it('promoting again reuses the set and its tunes', () => {
			const h = make();
			const first = h.change((l) => promoteTheSessionSet(l, SET));
			const again = h.change((l) => promoteTheSessionSet(l, SET));
			expect(again).toMatchObject({ setId: first.setId, existed: true, created: [] });
			expect(again.tunes).toEqual(first.tunes);
			expect(Object.keys(h.lib.pieces)).toHaveLength(4);
			expect(Object.keys(h.lib.links)).toHaveLength(3);
			expect(h.lib.links[linkId(first.setId, first.tunes[0])]).toBeDefined();
			expect(piecesWithTune(h.lib, 55).map((p) => p.id)).toEqual([first.tunes[1]]);
		});
	});
});

describe('duplicate tune detection', () => {
	it('groups live pieces by tune id', () => {
		const lib = emptyLibrary();
		const a = createPiece(lib, { now: 1, id: 'a' as PieceId });
		const b = createPiece(lib, { now: 2, id: 'b' as PieceId });
		const c = createPiece(lib, { now: 3, id: 'c' as PieceId });
		for (const id of [a, b, c]) linkTheSessionTune(lib, id, COOLEYS);
		lib.pieces[c].deletedAt = 4;
		const index = buildIndex(lib);
		expect(index.duplicateTunes).toEqual([{ tuneId: 1, pieces: [lib.pieces[a], lib.pieces[b]] }]);
		expect(index.withTune(1).map((p) => p.id)).toEqual(['a', 'b']);
	});
});
