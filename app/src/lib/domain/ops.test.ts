import { describe, expect, it } from 'vitest';
import * as Automerge from '@automerge/automerge';
import { emptyLibrary } from './library';
import {
	PieceNotFoundError,
	addTag,
	createPiece,
	logPractice,
	removeTag,
	setListSettings,
	softDelete,
	undoDelete,
	unlogPractice,
	updatePiece
} from './ops';
import { copyMissing } from './transfer';
import type { Library, PieceId } from './types';

/** Runs ops either on a plain object or through Automerge.change on a real doc. */
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

describe.each([
	['plain object', plain],
	['Automerge doc', automerge]
])('ops on a %s', (_, make) => {
	function withPiece(init: Parameters<typeof createPiece>[1] = {}) {
		const h = make();
		const id = h.change((l) => createPiece(l, { now: 1000, ...init }));
		return { h, id, piece: () => h.lib.pieces[id] };
	}

	describe('createPiece', () => {
		it('adds a blank, unrated tune by default', () => {
			const { piece, id } = withPiece();
			expect(piece()).toEqual({
				id,
				kind: 'tune',
				tags: {},
				favorite: false,
				clips: {},
				practice: [],
				createdAt: 1000,
				modifiedAt: 1000
			});
			expect('skill' in piece()).toBe(false);
		});

		it('takes a kind and title, and ignores a blank title', () => {
			const { piece } = withPiece({ kind: 'set', title: '  The  Kesh ' });
			expect(piece().kind).toBe('set');
			expect(piece().title).toBe('The Kesh');
			const blank = withPiece({ title: '   ' });
			expect('title' in blank.piece()).toBe(false);
		});

		it('gives distinct ids', () => {
			const h = make();
			const a = h.change((l) => createPiece(l));
			const b = h.change((l) => createPiece(l));
			expect(a).not.toBe(b);
			expect(Object.keys(h.lib.pieces)).toHaveLength(2);
		});
	});

	describe('updatePiece', () => {
		it('sets fields and bumps modifiedAt', () => {
			const { h, id, piece } = withPiece();
			const changed = h.change((l) =>
				updatePiece(
					l,
					id,
					{
						kind: 'part',
						title: 'Cooley’s',
						description: 'Line one\nline two  ',
						key: 'Edor',
						firstNotes: 'D2 | EBBA B2 EB',
						skill: 3,
						favorite: true
					},
					2000
				)
			);
			expect(changed).toBe(true);
			expect(piece()).toMatchObject({
				kind: 'part',
				title: 'Cooley’s',
				description: 'Line one\nline two',
				key: 'E dorian',
				firstNotes: 'D2 | EBBA B2 EB',
				skill: 3,
				favorite: true,
				modifiedAt: 2000
			});
		});

		it('clears optional fields with null or blank text, without leaving undefined', () => {
			const { h, id, piece } = withPiece();
			h.change((l) =>
				updatePiece(l, id, { title: 'A', description: 'B', key: 'D', firstNotes: 'C', skill: 2 })
			);
			h.change((l) =>
				updatePiece(
					l,
					id,
					{ title: null, description: '  ', key: '', firstNotes: null, skill: null },
					3000
				)
			);
			for (const field of ['title', 'description', 'key', 'firstNotes', 'skill']) {
				expect(field in piece()).toBe(false);
			}
			expect(piece().modifiedAt).toBe(3000);
			expect(hasUndefined(h.lib)).toBe(false);
		});

		it('keeps free-text keys that do not parse', () => {
			const { h, id, piece } = withPiece();
			h.change((l) => updatePiece(l, id, { key: '  modal-ish  ' }));
			expect(piece().key).toBe('modal-ish');
		});

		it('leaves modifiedAt alone when nothing changes', () => {
			const { h, id, piece } = withPiece({ title: 'Same' });
			const changed = h.change((l) =>
				updatePiece(l, id, { title: 'Same', favorite: false, kind: 'tune', skill: null }, 5000)
			);
			expect(changed).toBe(false);
			expect(piece().modifiedAt).toBe(1000);
		});

		it('rejects out-of-range skill', () => {
			const { h, id } = withPiece();
			expect(() => h.change((l) => updatePiece(l, id, { skill: 6 as never }))).toThrow(RangeError);
		});

		it('throws for an unknown piece', () => {
			const h = make();
			expect(() => h.change((l) => updatePiece(l, 'nope' as PieceId, { title: 'x' }))).toThrow(
				PieceNotFoundError
			);
		});
	});

	describe('tags', () => {
		it('adds as typed and bumps modifiedAt', () => {
			const { h, id, piece } = withPiece();
			const stored = h.change((l) => addTag(l, id, '  Slip  Jig ', 2000));
			expect(stored).toBe('Slip Jig');
			expect(piece().tags).toEqual({ 'Slip Jig': true });
			expect(piece().modifiedAt).toBe(2000);
		});

		it('matches case-insensitively and keeps the first casing', () => {
			const h = make();
			const a = h.change((l) => createPiece(l, { now: 1 }));
			const b = h.change((l) => createPiece(l, { now: 2 }));
			h.change((l) => addTag(l, a, 'Reel'));
			expect(h.change((l) => addTag(l, a, 'REEL'))).toBe('Reel');
			expect(h.change((l) => addTag(l, b, 'reel'))).toBe('Reel');
			expect(h.lib.pieces[a].tags).toEqual({ Reel: true });
			expect(h.lib.pieces[b].tags).toEqual({ Reel: true });
		});

		it('ignores blank tags', () => {
			const { h, id, piece } = withPiece();
			expect(h.change((l) => addTag(l, id, '   '))).toBeUndefined();
			expect(piece().tags).toEqual({});
			expect(piece().modifiedAt).toBe(1000);
		});

		it('removes every casing of a tag', () => {
			const { h, id, piece } = withPiece();
			h.change((l) => {
				l.pieces[id].tags['Reel'] = true;
				l.pieces[id].tags['reel'] = true;
				l.pieces[id].tags['Jig'] = true;
			});
			expect(h.change((l) => removeTag(l, id, 'REEL', 4000))).toBe(true);
			expect(piece().tags).toEqual({ Jig: true });
			expect(piece().modifiedAt).toBe(4000);
			expect(h.change((l) => removeTag(l, id, 'reel', 5000))).toBe(false);
			expect(piece().modifiedAt).toBe(4000);
		});
	});

	describe('practice', () => {
		it('appends entries without bumping modifiedAt', () => {
			const { h, id, piece } = withPiece();
			h.change((l) => logPractice(l, id, { now: 2000, via: 'card' }));
			h.change((l) => logPractice(l, id, { now: 3000 }));
			expect(piece().practice).toEqual([{ at: 2000, via: 'card' }, { at: 3000 }]);
			expect(piece().modifiedAt).toBe(1000);
			expect(hasUndefined(h.lib)).toBe(false);
		});

		it('records and applies a skill change in the same action', () => {
			const { h, id, piece } = withPiece();
			h.change((l) => logPractice(l, id, { now: 2000, skillAfter: 4 }));
			expect(piece().practice).toEqual([{ at: 2000, skillAfter: 4 }]);
			expect(piece().skill).toBe(4);
			expect(piece().modifiedAt).toBe(2000);
		});

		it('can undo the last entry by timestamp', () => {
			const { h, id, piece } = withPiece();
			h.change((l) => logPractice(l, id, { now: 2000 }));
			h.change((l) => logPractice(l, id, { now: 3000 }));
			expect(h.change((l) => unlogPractice(l, id, 3000))).toBe(true);
			expect(piece().practice).toEqual([{ at: 2000 }]);
			expect(h.change((l) => unlogPractice(l, id, 3000))).toBe(false);
		});
	});

	describe('soft delete', () => {
		it('marks and restores without losing data', () => {
			const { h, id, piece } = withPiece({ title: 'Keep me' });
			h.change((l) => softDelete(l, id, 2000));
			expect(piece().deletedAt).toBe(2000);
			h.change((l) => softDelete(l, id, 3000));
			expect(piece().deletedAt).toBe(2000);
			h.change((l) => undoDelete(l, id));
			expect('deletedAt' in piece()).toBe(false);
			expect(piece().title).toBe('Keep me');
		});
	});

	describe('setListSettings', () => {
		it('merges fields and clears optional ones', () => {
			const h = make();
			h.change((l) =>
				setListSettings(l, {
					sort: 'lastPracticed',
					descending: true,
					kinds: { tune: true, set: true, part: false, session: false },
					tags: { Reel: true, Jig: true },
					tagMode: 'all',
					skillMin: 2,
					favoritesOnly: true,
					practiced: { within: false, days: 14 }
				})
			);
			h.change((l) =>
				setListSettings(l, {
					tags: { Reel: true },
					favoritesOnly: undefined,
					practiced: { within: true, days: 7 }
				})
			);
			expect(h.lib.settings.list).toEqual({
				sort: 'lastPracticed',
				descending: true,
				kinds: { tune: true, set: true, part: false, session: false },
				tags: { Reel: true },
				tagMode: 'all',
				skillMin: 2,
				practiced: { within: true, days: 7 }
			});
			expect(hasUndefined(h.lib)).toBe(false);
		});
	});

	describe('copyMissing', () => {
		it('adds pieces the target lacks and leaves existing ones alone', () => {
			const other = emptyLibrary();
			const shared = createPiece(other, { title: 'Theirs', now: 1 });
			const extra = createPiece(other, { title: 'New', now: 2 });
			const h = make();
			h.change((l) => createPiece(l, { id: shared, title: 'Mine', now: 3 }));
			const result = h.change((l) => copyMissing(l, other));
			expect(result).toEqual({ pieces: 1, sources: 0, links: 0 });
			expect(h.lib.pieces[shared].title).toBe('Mine');
			expect(h.lib.pieces[extra].title).toBe('New');
		});
	});
});

describe('concurrent merges', () => {
	function fork() {
		let base = Automerge.from(
			emptyLibrary() as unknown as Record<string, unknown>
		) as unknown as Automerge.Doc<Library>;
		let id!: PieceId;
		base = Automerge.change(base, (d) => {
			id = createPiece(d, { title: 'Tune', now: 1 });
		});
		return { a: Automerge.clone(base), b: Automerge.clone(base), id };
	}

	it('does not duplicate a tag added on both forks', () => {
		const { id, ...forks } = fork();
		let { a, b } = forks;
		a = Automerge.change(a, (d) => void addTag(d, id, 'Reel', 10));
		b = Automerge.change(b, (d) => void addTag(d, id, 'Reel', 20));
		const merged = Automerge.merge(a, b);
		expect(Object.keys(merged.pieces[id].tags)).toEqual(['Reel']);
	});

	it('keeps practice entries logged on both forks', () => {
		const { id, ...forks } = fork();
		let { a, b } = forks;
		a = Automerge.change(a, (d) => void logPractice(d, id, { now: 10 }));
		b = Automerge.change(b, (d) => void logPractice(d, id, { now: 20 }));
		const merged = Automerge.merge(a, b);
		expect(merged.pieces[id].practice.map((e) => e.at).sort()).toEqual([10, 20]);
	});

	it('keeps a delete when the other fork edits', () => {
		const { id, ...forks } = fork();
		let { a, b } = forks;
		a = Automerge.change(a, (d) => softDelete(d, id, 10));
		b = Automerge.change(b, (d) => void updatePiece(d, id, { title: 'Edited' }, 20));
		const merged = Automerge.merge(a, b);
		expect(merged.pieces[id].deletedAt).toBe(10);
		expect(merged.pieces[id].title).toBe('Edited');
	});

	it('keeps independent settings changes from both forks', () => {
		let { a, b } = fork();
		a = Automerge.change(a, (d) => setListSettings(d, { sort: 'skill' }));
		b = Automerge.change(b, (d) => setListSettings(d, { favoritesOnly: true }));
		const merged = Automerge.merge(a, b);
		expect(merged.settings.list.sort).toBe('skill');
		expect(merged.settings.list.favoritesOnly).toBe(true);
	});
});
