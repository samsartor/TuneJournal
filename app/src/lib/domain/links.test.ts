// M5: editing links, split, merge undo, effective practice and Part → Tune inheritance.

import { describe, expect, it } from 'vitest';
import * as Automerge from '@automerge/automerge';
import { buildIndex } from './derived';
import { emptyLibrary } from './library';
import { addTag, createPiece, logPractice, updatePiece } from './ops';
import { addRecording, orphanSources, updateClip } from './recordings';
import {
	CHILD_KIND,
	addChild,
	childLinks,
	linkPieces,
	linkProblem,
	mergeWithUndo,
	moveChild,
	moveChildAfter,
	moveChildBy,
	removeLink,
	restoreLink,
	splitPiece,
	undoMerge
} from './relations';
import type { Library, PieceId, PieceKind } from './types';

interface Harness {
	readonly lib: Library;
	change<T>(fn: (lib: Library) => T): T;
}

function plain(): Harness {
	const lib = emptyLibrary();
	return { lib, change: (fn) => fn(lib) };
}

function automerge(doc = Automerge.from(emptyLibrary() as never) as unknown as Library): Harness & {
	doc(): Library;
} {
	return {
		get lib() {
			return doc;
		},
		doc: () => doc,
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

const kids = (lib: Library, parent: PieceId) => childLinks(lib, parent).map((l) => l.child);

function make(h: Harness, kind: PieceKind, title: string, created: number) {
	return h.change((l) => createPiece(l, { kind, title, now: created, id: title as PieceId }));
}

describe.each([
	['plain object', plain],
	['Automerge doc', () => automerge()]
])('link editing on a %s', (_, harness) => {
	it('labels children by the conventional kind', () => {
		expect(CHILD_KIND).toEqual({ session: 'set', set: 'tune', tune: 'part', part: 'part' });
	});

	it('adds a new child of the conventional kind, last', () => {
		const h = harness();
		const set = make(h, 'set', 'Set', 1);
		const a = make(h, 'tune', 'A', 2);
		h.change((l) => linkPieces(l, set, a));
		const b = h.change((l) => addChild(l, set, { title: 'B', now: 3 }));
		expect(h.lib.pieces[b]).toMatchObject({ kind: 'tune', title: 'B', createdAt: 3 });
		expect(kids(h.lib, set)).toEqual([a, b]);
		expect(hasUndefined(h.lib)).toBe(false);
	});

	it('flags self links, duplicates and cycles', () => {
		const h = harness();
		const [s, t, p] = [make(h, 'set', 'S', 1), make(h, 'tune', 'T', 2), make(h, 'part', 'P', 3)];
		h.change((l) => {
			linkPieces(l, s, t);
			linkPieces(l, t, p);
		});
		expect(linkProblem(h.lib, s, s)).toBe('self');
		expect(linkProblem(h.lib, s, t)).toBe('exists');
		expect(linkProblem(h.lib, p, s)).toBe('cycle');
		expect(linkProblem(h.lib, t, s)).toBe('cycle');
		expect(linkProblem(h.lib, s, p)).toBeUndefined();
		// Cycles are allowed by the model.
		h.change((l) => linkPieces(l, p, s));
		expect(kids(h.lib, p)).toEqual([s]);
	});

	it('reorders children by moving one link', () => {
		const h = harness();
		const set = make(h, 'set', 'Set', 0);
		const ids = ['A', 'B', 'C', 'D'].map((t, i) => make(h, 'tune', t, i + 1));
		h.change((l) => ids.forEach((id) => linkPieces(l, set, id)));
		const before = JSON.stringify(h.lib.links);
		expect(h.change((l) => moveChild(l, set, 'D' as PieceId, 0))).toBe(true);
		expect(kids(h.lib, set)).toEqual(['D', 'A', 'B', 'C']);
		h.change((l) => moveChildBy(l, set, 'A' as PieceId, 1));
		expect(kids(h.lib, set)).toEqual(['D', 'B', 'A', 'C']);
		expect(h.change((l) => moveChildBy(l, set, 'C' as PieceId, 1))).toBe(false);
		expect(h.change((l) => moveChildAfter(l, set, 'B' as PieceId, 'D' as PieceId))).toBe(false);
		expect(h.change((l) => moveChildAfter(l, set, 'B' as PieceId, 'nope' as PieceId))).toBe(false);
		// Only the moved links changed.
		const changed = Object.keys(h.lib.links).filter(
			(id) => JSON.parse(before)[id].order !== h.lib.links[id as keyof typeof h.lib.links].order
		);
		expect(changed.sort()).toEqual(['Set:A', 'Set:D']);
	});

	it('moves past hidden siblings by neighbour', () => {
		const h = harness();
		const set = make(h, 'set', 'Set', 0);
		const ids = ['A', 'B', 'C'].map((t, i) => make(h, 'tune', t, i + 1));
		h.change((l) => ids.forEach((id) => linkPieces(l, set, id)));
		// If B were deleted the UI would show [A, C]; moving C after nothing puts it first.
		h.change((l) => moveChildAfter(l, set, 'C' as PieceId, null));
		expect(kids(h.lib, set)).toEqual(['C', 'A', 'B']);
		h.change((l) => moveChildAfter(l, set, 'C' as PieceId, 'A' as PieceId));
		expect(kids(h.lib, set)).toEqual(['A', 'C', 'B']);
	});

	it('removes a link without touching the pieces, and restores it in place', () => {
		const h = harness();
		const set = make(h, 'set', 'Set', 0);
		const [a, b, c] = ['A', 'B', 'C'].map((t, i) => make(h, 'tune', t, i + 1));
		h.change((l) => [a, b, c].forEach((id) => linkPieces(l, set, id)));
		const removed = h.change((l) => removeLink(l, set, b))!;
		expect(kids(h.lib, set)).toEqual([a, c]);
		expect(h.lib.pieces[b].deletedAt).toBeUndefined();
		h.change((l) => restoreLink(l, removed));
		expect(kids(h.lib, set)).toEqual([a, b, c]);
		expect(h.change((l) => removeLink(l, set, 'nope' as PieceId))).toBeUndefined();
	});
});

describe.each([
	['plain object', plain],
	['Automerge doc', () => automerge()]
])('split on a %s', (_, harness) => {
	function withRecording() {
		const h = harness();
		const tune = make(h, 'tune', 'Tune', 1);
		const rec = h.change((l) =>
			addRecording(
				l,
				tune,
				{ provider: 'upload', url: '', id: 'src1' as never, durationSec: 60 },
				{ key: 'D' },
				2
			)
		);
		return { h, tune, rec };
	}

	it('makes a child with a clip on the same source, without copying the source', () => {
		const { h, tune, rec } = withRecording();
		const a = h.change((l) =>
			splitPiece(l, tune, { clipId: rec.clipId, start: 0, end: 20.5, title: 'A part', now: 5 })
		);
		const b = h.change((l) =>
			splitPiece(l, tune, { clipId: rec.clipId, start: 20.5, end: 41, now: 6 })
		);
		expect(Object.keys(h.lib.sources)).toEqual(['src1']);
		const partA = h.lib.pieces[a.pieceId];
		expect(partA).toMatchObject({ kind: 'part', title: 'A part' });
		expect(partA.clips[a.clipId!]).toMatchObject({ sourceId: 'src1', end: 20.5, key: 'D major' });
		expect(partA.clips[a.clipId!].start).toBeUndefined();
		expect(h.lib.pieces[b.pieceId].clips[b.clipId!]).toMatchObject({
			sourceId: 'src1',
			start: 20.5,
			end: 41
		});
		expect(h.lib.pieces[b.pieceId].title).toBeUndefined();
		expect(kids(h.lib, tune)).toEqual([a.pieceId, b.pieceId]);
		// The parent keeps its own clip.
		expect(Object.keys(h.lib.pieces[tune].clips)).toEqual([rec.clipId]);
		expect(orphanSources(h.lib)).toEqual([]);
		expect(hasUndefined(h.lib)).toBe(false);
		// No bounds given: the parent clip's own; null: the whole recording.
		const whole = h.change((l) =>
			splitPiece(l, tune, { clipId: rec.clipId, start: null, end: null })
		);
		expect(h.lib.pieces[whole.pieceId].clips[whole.clipId!]).not.toHaveProperty('end');
		expect(Object.keys(h.lib.sources)).toEqual(['src1']);
	});

	it('makes a blank child without a clip, and refuses a bad region before writing', () => {
		const { h, tune, rec } = withRecording();
		const blank = h.change((l) => splitPiece(l, tune, { now: 3 }));
		expect(blank.clipId).toBeUndefined();
		expect(h.lib.pieces[blank.pieceId]).toMatchObject({ kind: 'part', clips: {} });
		const count = Object.keys(h.lib.pieces).length;
		expect(() =>
			h.change((l) => splitPiece(l, tune, { clipId: rec.clipId, start: 30, end: 10 }))
		).toThrow(RangeError);
		expect(Object.keys(h.lib.pieces)).toHaveLength(count);
	});

	it('splits Sets into Tunes and Sessions into Sets', () => {
		const h = harness();
		const session = make(h, 'session', 'Session', 1);
		const set = make(h, 'set', 'Set', 2);
		const a = h.change((l) => splitPiece(l, session)).pieceId;
		const b = h.change((l) => splitPiece(l, set)).pieceId;
		expect(h.lib.pieces[a].kind).toBe('set');
		expect(h.lib.pieces[b].kind).toBe('tune');
	});
});

describe.each([
	['plain object', plain],
	['Automerge doc', () => automerge()]
])('merge undo on a %s', (_, harness) => {
	it('puts both pieces, their links and fields back', () => {
		const h = harness();
		const set = make(h, 'set', 'Set', 0);
		const other = make(h, 'set', 'Other set', 0);
		const a = make(h, 'tune', 'Cooley’s', 1);
		const b = make(h, 'tune', 'Cooleys', 2);
		const part = make(h, 'part', 'B part', 3);
		h.change((l) => {
			updatePiece(l, a, { skill: 2, key: 'Edor' }, 1);
			updatePiece(l, b, { skill: 4, favorite: true, description: 'from b' }, 2);
			addTag(l, a, 'Reel', 1);
			addTag(l, b, 'Session', 2);
			logPractice(l, a, { now: 10 });
			logPractice(l, b, { now: 20 });
			addRecording(l, b, { provider: 'youtube', url: 'u', externalId: 'yt' }, {}, 2);
			linkPieces(l, set, a);
			linkPieces(l, other, b);
			linkPieces(l, b, part);
		});
		const before = JSON.parse(JSON.stringify(h.lib));

		const { id, undo } = h.change((l) => mergeWithUndo(l, a, b, { now: 50 }));
		expect(id).toBe(a);
		expect(h.lib.pieces[b].mergedInto).toBe(a);
		expect(kids(h.lib, other)).toEqual([a]);
		expect(h.lib.pieces[a].skill).toBe(4);
		expect(JSON.parse(JSON.stringify(undo))).toEqual(undo);

		// Practice logged after the merge survives the undo.
		h.change((l) => logPractice(l, a, { now: 60 }));
		h.change((l) => undoMerge(l, undo, 70));

		const after = JSON.parse(JSON.stringify(h.lib));
		expect(after.links).toEqual(before.links);
		expect(after.pieces[b]).toEqual(before.pieces[b]);
		const without = (p: Record<string, unknown>) => ({ ...p, modifiedAt: 0, practice: [] });
		expect(without(after.pieces[a])).toEqual(without(before.pieces[a]));
		expect(after.pieces[a].practice).toEqual([...before.pieces[a].practice, { at: 60 }]);
		expect(hasUndefined(h.lib)).toBe(false);
		const index = buildIndex(h.lib);
		expect(index.live.map((p) => p.id).sort()).toEqual([a, b, part, other, set].sort());
	});

	it('keeps practice entries both pieces shared, and an earlier deletion', () => {
		const h = harness();
		const a = make(h, 'tune', 'A', 1);
		const b = make(h, 'tune', 'B', 2);
		h.change((l) => {
			logPractice(l, a, { now: 10 });
			logPractice(l, b, { now: 10 });
			l.pieces[b].deletedAt = 5;
		});
		const { undo } = h.change((l) => mergeWithUndo(l, a, b, { now: 50 }));
		h.change((l) => undoMerge(l, undo));
		expect(h.lib.pieces[a].practice).toEqual([{ at: 10 }]);
		expect(h.lib.pieces[b]).toMatchObject({ deletedAt: 5 });
		expect(h.lib.pieces[b].mergedInto).toBeUndefined();
	});
});

describe('concurrent link edits on Automerge forks', () => {
	it('merges a link added on one device with another removed on the other', () => {
		const base = automerge();
		const set = make(base, 'set', 'Set', 0);
		const [a, b, c] = ['A', 'B', 'C'].map((t, i) => make(base, 'tune', t, i + 1));
		base.change((l) => {
			linkPieces(l, set, a);
			linkPieces(l, set, b);
		});
		const left = automerge(Automerge.clone(base.doc() as never) as unknown as Library);
		const right = automerge(Automerge.clone(base.doc() as never) as unknown as Library);
		left.change((l) => linkPieces(l, set, c));
		left.change((l) => moveChild(l, set, a, 2));
		right.change((l) => removeLink(l, set, b));
		right.change((l) => linkPieces(l, set, c));
		const merged = Automerge.merge(left.doc() as never, right.doc() as never) as unknown as Library;
		expect(kids(merged, set)).toEqual([c, a]);
		expect(Object.keys(merged.links).filter((k) => k === `${set}:${c}`)).toHaveLength(1);
		const again = Automerge.merge(right.doc() as never, left.doc() as never) as unknown as Library;
		expect(kids(again, set)).toEqual(kids(merged, set));
	});

	it('keeps a link removed on one device and re-added on the other once', () => {
		const base = automerge();
		const set = make(base, 'set', 'Set', 0);
		const a = make(base, 'tune', 'A', 1);
		base.change((l) => linkPieces(l, set, a));
		const left = automerge(Automerge.clone(base.doc() as never) as unknown as Library);
		const right = automerge(Automerge.clone(base.doc() as never) as unknown as Library);
		const removed = left.change((l) => removeLink(l, set, a))!;
		left.change((l) => restoreLink(l, removed));
		right.change((l) => removeLink(l, set, a));
		const merged = Automerge.merge(left.doc() as never, right.doc() as never) as unknown as Library;
		// Either outcome is fine; it must be one link or none, the same on both sides.
		const other = Automerge.merge(right.doc() as never, left.doc() as never) as unknown as Library;
		expect(kids(merged, set)).toEqual(kids(other, set));
		expect(kids(merged, set).length).toBeLessThanOrEqual(1);
	});
});

describe('effective practice and inheritance', () => {
	const DAY = 86_400_000;

	function hierarchy() {
		const h = plain();
		const session = make(h, 'session', 'Session', 0);
		const set = make(h, 'set', 'Set', 1);
		const set2 = make(h, 'set', 'Set two', 2);
		const tune = make(h, 'tune', 'Tune', 3);
		const tune2 = make(h, 'tune', 'Later tune', 4);
		const part = make(h, 'part', 'Part', 5);
		h.change((l) => {
			linkPieces(l, session, set);
			linkPieces(l, set, tune);
			linkPieces(l, set2, tune); // multiple parents
			linkPieces(l, tune2, part);
			linkPieces(l, tune, part);
		});
		return { h, session, set, set2, tune, tune2, part };
	}

	it('combines own and ancestor entries, marking inherited ones', () => {
		const { h, session, set, set2, tune, part } = hierarchy();
		h.change((l) => {
			logPractice(l, tune, { now: 1 * DAY });
			logPractice(l, set, { now: 3 * DAY });
			logPractice(l, set2, { now: 2 * DAY });
			logPractice(l, session, { now: 4 * DAY });
		});
		const index = buildIndex(h.lib);
		const t = index.get(tune)!;
		expect(index.effectivePractice(t)).toEqual([
			{ at: 4 * DAY, viaPiece: session },
			{ at: 3 * DAY, viaPiece: set },
			{ at: 2 * DAY, viaPiece: set2 },
			{ at: 1 * DAY }
		]);
		expect(index.stats(t)).toEqual({ timesPracticed: 4, lastPracticed: 4 * DAY });
		expect(index.stats(index.get(part)!).timesPracticed).toBe(4);
		expect(index.stats(index.get(set)!).timesPracticed).toBe(2);
		expect(index.stats(index.get(session)!).timesPracticed).toBe(1);
		// Children's practice doesn't flow up.
		expect(index.ancestors(index.get(session)!)).toEqual([]);
		expect(index.ancestors(index.get(part)!).map((p) => p.id)).toEqual([
			'Later tune',
			tune,
			set,
			set2,
			session
		]);
		// The doc itself is untouched (propagation is query-time only).
		expect(h.lib.pieces[tune].practice).toEqual([{ at: DAY }]);
	});

	it('survives cycles, counting each ancestor once', () => {
		const { h, session, set, tune } = hierarchy();
		h.change((l) => {
			linkPieces(l, tune, session); // tune → session → set → tune
			logPractice(l, set, { now: 7 });
			logPractice(l, tune, { now: 8 });
		});
		const index = buildIndex(h.lib);
		const entries = index.effectivePractice(index.get(tune)!);
		expect(entries).toEqual([{ at: 8 }, { at: 7, viaPiece: set }]);
		expect(index.effectivePractice(index.get(session)!)).toEqual([
			{ at: 8, viaPiece: tune },
			{ at: 7, viaPiece: set }
		]);
	});

	it('ignores deleted ancestors and follows merges', () => {
		const { h, set, set2, tune } = hierarchy();
		h.change((l) => {
			logPractice(l, set, { now: 7 });
			logPractice(l, set2, { now: 9 });
			l.pieces[set2].deletedAt = 10;
		});
		const index = buildIndex(h.lib);
		expect(index.effectivePractice(index.get(tune)!)).toEqual([{ at: 7, viaPiece: set }]);
	});

	it('Parts inherit skill and key from the earliest-created parent Tune only', () => {
		const { h, set, tune, tune2, part } = hierarchy();
		h.change((l) => {
			updatePiece(l, tune, { skill: 3, key: 'Ador', firstNotes: 'eAAG', favorite: true });
			updatePiece(l, tune2, { skill: 5, key: 'G' });
			updatePiece(l, set, { skill: 4 });
			addTag(l, tune, 'Reel');
		});
		let index = buildIndex(h.lib);
		const p = index.get(part)!;
		// "Later tune" was linked first but "Tune" was created first.
		expect(index.inheritsFrom(p)?.id).toBe(tune);
		expect(index.effectiveSkill(p)).toBe(3);
		expect(index.effectiveKey(p)).toBe('A dorian');
		expect(index.tagsOf(p)).toEqual([]);
		// Tunes don't inherit from Sets.
		const t = make(h, 'tune', 'Bare tune', 9);
		h.change((l) => linkPieces(l, set, t));
		index = buildIndex(h.lib);
		expect(index.effectiveSkill(index.get(t)!)).toBeUndefined();
		expect(index.inheritsFrom(index.get(t)!)).toBeUndefined();

		// Own values win, and clearing them goes back to inheriting.
		h.change((l) => updatePiece(l, part, { skill: 1, key: 'D' }));
		index = buildIndex(h.lib);
		expect(index.effectiveSkill(index.get(part)!)).toBe(1);
		expect(index.effectiveKey(index.get(part)!)).toBe('D major');
		h.change((l) => updatePiece(l, part, { skill: null, key: null }));
		index = buildIndex(h.lib);
		expect(index.effectiveSkill(index.get(part)!)).toBe(3);
	});

	it('key and first notes fall back to the first recording that has them, then the Tune', () => {
		const { h, tune, part } = hierarchy();
		const yt = { provider: 'youtube' as const, url: 'https://youtu.be/x', externalId: 'x' };
		const sp = { provider: 'spotify' as const, url: 'https://sp/y', externalId: 'track:y' };
		const { clipId: first } = h.change((l) => addRecording(l, tune, yt));
		const { clipId: second } = h.change((l) =>
			addRecording(l, tune, sp, { key: 'Bmin', firstNotes: 'B2 dB' })
		);
		let index = buildIndex(h.lib);
		let t = index.get(tune)!;
		// The first clip has nothing, so the second one's values show.
		expect(index.keyOf(t)).toMatchObject({
			value: 'B minor',
			origin: { from: 'clip', clip: { id: second } }
		});
		expect(index.effectiveFirstNotes(t)).toBe('B2 dB');
		expect(index.keys).toContain('B minor');

		// The first clip in order wins once it has a value.
		h.change((l) => updateClip(l, tune, first, { key: 'Ador' }));
		index = buildIndex(h.lib);
		t = index.get(tune)!;
		expect(index.effectiveKey(t)).toBe('A dorian');
		expect(index.effectiveFirstNotes(t)).toBe('B2 dB');
		// A clip's own key shows on that clip; others use the piece's effective key.
		expect(index.clipKey(t, h.lib.pieces[tune].clips[second])).toBe('B minor');

		// A Part with nothing of its own: its own clips first, then its Tune's effective key. First
		// notes never come from the Tune.
		let p = index.get(part)!;
		expect(index.keyOf(p)).toMatchObject({ value: 'A dorian', origin: { from: 'tune' } });
		expect(index.effectiveFirstNotes(p)).toBeUndefined();
		const { clipId: partClip } = h.change((l) =>
			addRecording(l, part, { provider: 'upload', url: '' }, { key: 'E dor', firstNotes: 'e2' })
		);
		index = buildIndex(h.lib);
		p = index.get(part)!;
		expect(index.keyOf(p)).toMatchObject({
			value: 'E dorian',
			origin: { from: 'clip', clip: { id: partClip } }
		});
		expect(index.effectiveFirstNotes(p)).toBe('e2');

		// The piece's own values win over everything.
		h.change((l) => updatePiece(l, tune, { key: 'G', firstNotes: 'GABc' }));
		index = buildIndex(h.lib);
		t = index.get(tune)!;
		expect(index.keyOf(t)).toEqual({ value: 'G major', origin: { from: 'own' } });
		expect(index.firstNotesOf(t)).toEqual({ value: 'GABc', origin: { from: 'own' } });
		expect(index.clipFirstNotes(t, h.lib.pieces[tune].clips[first])).toBe('GABc');

		// Sets and sessions have neither, whatever their recordings say.
		const set = make(h, 'set', 'A set', 20);
		h.change((l) => addRecording(l, set, sp, { key: 'Dmaj' }));
		index = buildIndex(h.lib);
		expect(index.effectiveKey(index.get(set)!)).toBeUndefined();
	});

	it('filters and sorts by the effective values', async () => {
		const { h, set, tune, part } = hierarchy();
		h.change((l) => {
			updatePiece(l, tune, { skill: 4, key: 'Ador' });
			logPractice(l, set, { now: 5 * DAY });
		});
		const { listPieces } = await import('./derived');
		const index = buildIndex(h.lib);
		const parts = listPieces(index, {
			settings: {
				sort: 'skill',
				descending: true,
				kinds: { part: true, tune: false, set: false, session: false },
				skillMin: 4,
				key: 'A dorian',
				practiced: { within: true, days: 2 }
			},
			now: 6 * DAY
		});
		expect(parts.map((p) => p.id)).toEqual([part]);
	});

	it('builds the index for 3000 linked pieces quickly', () => {
		const lib = emptyLibrary();
		const sessions: PieceId[] = [];
		const sets: PieceId[] = [];
		const tunes: PieceId[] = [];
		let n = 0;
		const add = (kind: PieceKind) =>
			createPiece(lib, { kind, title: `${kind} ${n}`, now: n++, id: `p${n}` as PieceId });
		for (let i = 0; i < 50; i++) sessions.push(add('session'));
		for (let i = 0; i < 450; i++) {
			const set = add('set');
			sets.push(set);
			linkPieces(lib, sessions[i % 50], set);
			logPractice(lib, set, { now: i });
		}
		for (let i = 0; i < 1500; i++) {
			const tune = add('tune');
			tunes.push(tune);
			updatePiece(lib, tune, { skill: ((i % 5) + 1) as 1 });
			for (let j = 0; j < 3; j++) linkPieces(lib, sets[(i * 7 + j * 13) % 450], tune);
			logPractice(lib, tune, { now: i });
		}
		for (let i = 0; i < 1000; i++) linkPieces(lib, tunes[i], add('part'));
		// A few cycles for good measure.
		for (let i = 0; i < 20; i++) linkPieces(lib, tunes[i], sessions[i]);
		expect(Object.keys(lib.pieces)).toHaveLength(3000);

		const t0 = performance.now();
		const index = buildIndex(lib);
		let total = 0;
		for (const piece of index.live) {
			total += index.stats(piece).timesPracticed;
			index.effectiveSkill(piece);
			index.effectiveKey(piece);
		}
		const elapsed = performance.now() - t0;
		expect(total).toBeGreaterThan(3000);

		expect(elapsed).toBeLessThan(1500);
	});
});
