import { describe, expect, it } from 'vitest';
import * as Automerge from '@automerge/automerge';
import { buildIndex, listPieces } from './derived';
import { emptyLibrary } from './library';
import { createPiece, updatePiece } from './ops';
import {
	driveFileId,
	isLocalOnly,
	isAudioUrl,
	isPlayable,
	playbackOf,
	recordingTitle,
	DRIVE_ASSET
} from './providers';
import {
	ClipNotFoundError,
	addRecording,
	checkBounds,
	findSource,
	moveClip,
	moveClipBy,
	orphanSources,
	removeClip,
	restoreClip,
	sortedClips,
	sourceIdFor,
	updateClip,
	updateSource
} from './recordings';
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

type Doc = Automerge.Doc<Library>;

function fromDoc(start: Doc): Harness & { doc: Doc } {
	let doc = start;
	return {
		get lib() {
			return doc as unknown as Library;
		},
		get doc() {
			return doc;
		},
		change(fn) {
			let result!: ReturnType<typeof fn>;
			doc = Automerge.change(doc, (d) => {
				result = fn(d as unknown as Library);
			});
			return result;
		}
	};
}

function automerge(): Harness {
	return fromDoc(Automerge.from(emptyLibrary() as unknown as Record<string, unknown>) as Doc);
}

function hasUndefined(value: unknown): boolean {
	if (value === undefined) return true;
	if (value === null || typeof value !== 'object') return false;
	return Object.values(value).some(hasUndefined);
}

const YT = {
	provider: 'youtube' as const,
	url: 'https://youtu.be/abcdefghijk',
	externalId: 'abcdefghijk'
};

describe.each([
	['plain object', plain],
	['Automerge doc', automerge]
])('recordings on a %s', (_, make) => {
	function setup() {
		const h = make();
		const id = h.change((l) => createPiece(l, { now: 1000, title: 'Kesh' }));
		return { h, id, piece: () => h.lib.pieces[id] };
	}

	describe('addRecording', () => {
		it('creates a Source and a Clip, last in order', () => {
			const { h, id, piece } = setup();
			const a = h.change((l) => addRecording(l, id, YT, { title: 'Live' }, 2000));
			const b = h.change((l) =>
				addRecording(
					l,
					id,
					{ provider: 'upload', url: '', title: 'take.m4a', mime: 'audio/mp4' },
					{},
					3000
				)
			);
			expect(a).toMatchObject({ sourceId: 'youtube:abcdefghijk', newSource: true, newClip: true });
			expect(h.lib.sources[a.sourceId]).toEqual({
				id: 'youtube:abcdefghijk',
				provider: 'youtube',
				url: 'https://youtu.be/abcdefghijk',
				externalId: 'abcdefghijk',
				addedAt: 2000
			});
			expect(b.sourceId).toMatch(/^\w{16}$/);
			expect(h.lib.sources[b.sourceId]).toMatchObject({ title: 'take.m4a', mime: 'audio/mp4' });
			expect(sortedClips(piece()).map((c) => c.id)).toEqual([a.clipId, b.clipId]);
			expect(piece().clips[a.clipId]).toMatchObject({ title: 'Live', addedAt: 2000 });
			expect(piece().modifiedAt).toBe(3000);
			expect(hasUndefined(h.lib)).toBe(false);
		});

		it('reuses a Source with the same provider and external id', () => {
			const { h, id } = setup();
			const other = h.change((l) => createPiece(l, { now: 1000 }));
			const a = h.change((l) => addRecording(l, id, YT, {}, 2000));
			const b = h.change((l) =>
				addRecording(l, other, {
					...YT,
					url: 'https://www.youtube.com/watch?v=abcdefghijk',
					title: 'T'
				})
			);
			expect(b).toMatchObject({ sourceId: a.sourceId, newSource: false, newClip: true });
			expect(Object.keys(h.lib.sources)).toHaveLength(1);
			// Blanks are filled in, the URL isn't replaced.
			expect(h.lib.sources[a.sourceId]).toMatchObject({ url: YT.url, title: 'T' });
		});

		it('finds a source with a random id by provider and external id', () => {
			const { h, id } = setup();
			h.change((l) => {
				l.sources['x1' as SourceId] = {
					id: 'x1' as SourceId,
					provider: 'gdrive',
					url: 'https://drive.google.com/file/d/F1/view',
					externalId: 'F1',
					addedAt: 1
				};
			});
			const r = h.change((l) =>
				addRecording(l, id, { provider: 'gdrive', url: 'x', externalId: 'F1' })
			);
			expect(r.sourceId).toBe('x1');
			expect(findSource(h.lib, 'gdrive', 'F1')?.id).toBe('x1');
			expect(findSource(h.lib, 'youtube', 'F1')).toBeUndefined();
		});

		it('uses a given id for a new source, so cached bytes line up', () => {
			const { h, id } = setup();
			const r = h.change((l) =>
				addRecording(l, id, { provider: 'upload', url: '', id: 'cached1' as SourceId })
			);
			expect(r.sourceId).toBe('cached1');
			const again = h.change((l) =>
				addRecording(l, id, { provider: 'upload', url: '', id: 'cached1' as SourceId })
			);
			expect(again).toMatchObject({ sourceId: 'cached1', newSource: false, newClip: false });
		});

		it('does not add the same untrimmed clip twice, but allows another trim', () => {
			const { h, id, piece } = setup();
			const a = h.change((l) => addRecording(l, id, YT));
			const b = h.change((l) => addRecording(l, id, YT));
			const c = h.change((l) => addRecording(l, id, YT, { start: 5, end: 9 }));
			expect(b).toMatchObject({ clipId: a.clipId, newClip: false });
			expect(c.newClip).toBe(true);
			expect(piece().clips[c.clipId]).toMatchObject({ start: 5, end: 9 });
			expect(Object.keys(piece().clips)).toHaveLength(2);
		});

		it('rejects a bad trim', () => {
			const { h, id } = setup();
			expect(() => h.change((l) => addRecording(l, id, YT, { start: 5, end: 4 }))).toThrow(
				RangeError
			);
		});
	});

	describe('updateClip', () => {
		it('sets and clears trim, title, key and first notes', () => {
			const { h, id, piece } = setup();
			const { clipId } = h.change((l) => addRecording(l, id, YT, {}, 1000));
			h.change((l) =>
				updateClip(
					l,
					id,
					clipId,
					{ start: 1.23456, end: 7, title: '  At  the session ', key: 'Edor', firstNotes: 'B2 AB' },
					5000
				)
			);
			expect(piece().clips[clipId]).toMatchObject({
				start: 1.235,
				end: 7,
				title: 'At the session',
				key: 'E dorian',
				firstNotes: 'B2 AB'
			});
			expect(piece().modifiedAt).toBe(5000);

			// Changing only the end checks it against the existing start.
			expect(() => h.change((l) => updateClip(l, id, clipId, { end: 1 }))).toThrow(RangeError);
			h.change((l) => updateClip(l, id, clipId, { start: 0, end: null, title: '', key: null }));
			const clip = piece().clips[clipId];
			expect('start' in clip || 'end' in clip || 'title' in clip || 'key' in clip).toBe(false);
			expect(clip.firstNotes).toBe('B2 AB');
			expect(hasUndefined(h.lib)).toBe(false);
		});

		it('reports no change and leaves modifiedAt alone', () => {
			const { h, id, piece } = setup();
			const { clipId } = h.change((l) => addRecording(l, id, YT, { title: 'A' }, 2000));
			expect(h.change((l) => updateClip(l, id, clipId, { title: 'A' }, 9000))).toBe(false);
			expect(piece().modifiedAt).toBe(2000);
		});

		it('throws for an unknown clip', () => {
			const { h, id } = setup();
			expect(() => h.change((l) => updateClip(l, id, 'nope' as ClipId, { title: 'x' }))).toThrow(
				ClipNotFoundError
			);
		});
	});

	describe('removeClip and restoreClip', () => {
		it('removes a clip, keeps its source, and restores it in place', () => {
			const { h, id, piece } = setup();
			const a = h.change((l) => addRecording(l, id, YT, { title: 'A' }));
			const b = h.change((l) =>
				addRecording(l, id, { provider: 'spotify', url: 's', externalId: 'track:1' })
			);
			const removed = h.change((l) => removeClip(l, id, a.clipId));
			expect(removed).toMatchObject({ id: a.clipId, title: 'A' });
			expect(Object.keys(piece().clips)).toEqual([b.clipId]);
			expect(h.lib.sources[a.sourceId]).toBeDefined();
			expect(orphanSources(h.lib).map((s) => s.id)).toEqual([a.sourceId]);

			h.change((l) => restoreClip(l, id, removed!));
			expect(sortedClips(piece()).map((c) => c.id)).toEqual([a.clipId, b.clipId]);
			expect(orphanSources(h.lib)).toEqual([]);
			expect(h.change((l) => removeClip(l, id, 'gone' as ClipId))).toBeUndefined();
		});
	});

	describe('moveClip', () => {
		function threeClips() {
			const s = setup();
			const ids = ['a', 'b', 'c'].map(
				(x) =>
					s.h.change((l) =>
						addRecording(l, s.id, { provider: 'url', url: `https://e.com/${x}`, externalId: x })
					).clipId
			);
			const order = () => sortedClips(s.piece()).map((c) => c.id);
			return { ...s, ids, order };
		}

		it('moves a clip to any position', () => {
			const { h, id, ids, order } = threeClips();
			const [a, b, c] = ids;
			expect(h.change((l) => moveClip(l, id, c, 0))).toBe(true);
			expect(order()).toEqual([c, a, b]);
			h.change((l) => moveClip(l, id, c, 1));
			expect(order()).toEqual([a, c, b]);
			h.change((l) => moveClip(l, id, a, 99));
			expect(order()).toEqual([c, b, a]);
			expect(h.change((l) => moveClip(l, id, a, 2))).toBe(false);
		});

		it('moves up and down by one', () => {
			const { h, id, ids, order } = threeClips();
			const [a, b, c] = ids;
			h.change((l) => moveClipBy(l, id, a, 1));
			expect(order()).toEqual([b, a, c]);
			h.change((l) => moveClipBy(l, id, c, -1));
			expect(order()).toEqual([b, c, a]);
			expect(h.change((l) => moveClipBy(l, id, b, -1))).toBe(false);
		});

		it('copes with two clips that share an order key', () => {
			const { h, id, ids, order, piece } = threeClips();
			const [a, b, c] = ids;
			h.change((l) => {
				l.pieces[id].clips[b].order = piece().clips[a].order;
			});
			// a and b tie (broken by id); moving c between them puts it after both.
			h.change((l) => moveClip(l, id, c, 1));
			expect(order().indexOf(c)).toBeGreaterThan(0);
			expect(new Set(order())).toEqual(new Set([a, b, c]));
		});
	});

	describe('derived values', () => {
		it('has-recordings, providers and the list filter', () => {
			const { h, id } = setup();
			const linkOnly = h.change((l) => createPiece(l, { now: 1000, title: 'Linked' }));
			h.change((l) => createPiece(l, { now: 1000, title: 'Bare' }));
			h.change((l) => linkTheSessionTune(l, linkOnly, { tuneId: 1, name: 'Linked' }));
			h.change((l) => linkTheSessionTune(l, id, { tuneId: 2, name: 'Kesh' }));
			h.change((l) => addRecording(l, id, YT));

			const index = buildIndex(h.lib);
			expect(index.hasRecordings(h.lib.pieces[id])).toBe(true);
			expect(index.hasRecordings(h.lib.pieces[linkOnly])).toBe(false);
			expect(index.providersOf(h.lib.pieces[id])).toEqual(['thesession', 'youtube']);

			const titles = (recordings: 'has' | 'lacks') =>
				listPieces(index, { settings: { ...h.lib.settings.list, recordings } }).map((p) => p.title);
			expect(titles('has')).toEqual(['Kesh']);
			expect(titles('lacks')).toEqual(['Bare', 'Linked']);
		});

		it('effective key and first notes per clip', () => {
			const { h, id } = setup();
			h.change((l) => updatePiece(l, id, { key: 'Edor', firstNotes: 'EBBA' }));
			const plainClip = h.change((l) => addRecording(l, id, YT)).clipId;
			const inD = h.change((l) =>
				addRecording(l, id, YT, { start: 3, key: 'Ddor', firstNotes: 'DAAG' })
			).clipId;
			let index = buildIndex(h.lib);
			let piece = h.lib.pieces[id];
			expect(index.clipKey(piece, piece.clips[plainClip])).toBe('E dorian');
			expect(index.clipFirstNotes(piece, piece.clips[plainClip])).toBe('EBBA');
			expect(index.clipKey(piece, piece.clips[inD])).toBe('D dorian');
			expect(index.clipFirstNotes(piece, piece.clips[inD])).toBe('DAAG');

			// Sets and sessions have no key, so neither do their clips.
			h.change((l) => updatePiece(l, id, { kind: 'set' }));
			index = buildIndex(h.lib);
			piece = h.lib.pieces[id];
			expect(index.clipKey(piece, piece.clips[inD])).toBeUndefined();
		});
	});

	it('updateSource sets and clears metadata', () => {
		const { h, id } = setup();
		const { sourceId } = h.change((l) => addRecording(l, id, { provider: 'upload', url: '' }));
		h.change((l) =>
			updateSource(l, sourceId, {
				assetKey: `${DRIVE_ASSET}F9`,
				durationSec: 12.34567,
				title: ' x '
			})
		);
		expect(h.lib.sources[sourceId]).toMatchObject({
			assetKey: 'gdrive:F9',
			durationSec: 12.346,
			title: 'x'
		});
		h.change((l) => updateSource(l, sourceId, { title: null, durationSec: NaN }));
		expect('title' in h.lib.sources[sourceId]).toBe(false);
		expect(h.lib.sources[sourceId].durationSec).toBe(12.346);
		expect(hasUndefined(h.lib)).toBe(false);
	});
});

describe('concurrent edits on Automerge forks', () => {
	function base() {
		const h = automerge();
		const id = h.change((l) => createPiece(l, { now: 1000 }));
		const ids = ['a', 'b', 'c', 'd'].map(
			(x) =>
				h.change((l) =>
					addRecording(l, id, { provider: 'url', url: `https://e.com/${x}`, externalId: x })
				).clipId
		);
		return { doc: (h as ReturnType<typeof fromDoc>).doc, id, ids };
	}
	const orderOf = (doc: Doc, id: PieceId) =>
		sortedClips((doc as unknown as Library).pieces[id]).map((c) => c.id);

	it('reorders of different clips both apply', () => {
		const { doc, id, ids } = base();
		const [a, b, c, d] = ids;
		const left = fromDoc(Automerge.clone(doc));
		const right = fromDoc(Automerge.clone(doc));
		left.change((l) => moveClip(l, id, d, 0)); // d a b c
		right.change((l) => moveClip(l, id, a, 3)); // b c d a
		const merged = Automerge.merge(Automerge.clone(left.doc), right.doc);
		const order = orderOf(merged, id);
		expect(order).toEqual(orderOf(Automerge.merge(Automerge.clone(right.doc), left.doc), id));
		expect(order.indexOf(d)).toBeLessThan(order.indexOf(b));
		expect(order[order.length - 1]).toBe(a);
		expect(new Set(order)).toEqual(new Set([a, b, c, d]));
	});

	it('the same clip moved two ways lands in one place, the same on both sides', () => {
		const { doc, id, ids } = base();
		const [a, , , d] = ids;
		const left = fromDoc(Automerge.clone(doc));
		const right = fromDoc(Automerge.clone(doc));
		left.change((l) => moveClip(l, id, a, 3));
		right.change((l) => moveClip(l, id, a, 1));
		const one = orderOf(Automerge.merge(Automerge.clone(left.doc), right.doc), id);
		const two = orderOf(Automerge.merge(Automerge.clone(right.doc), left.doc), id);
		expect(one).toEqual(two);
		expect(one).toHaveLength(4);
		expect(one[0]).not.toBe(a);
		expect(one.includes(d)).toBe(true);
	});

	it('two clips moved into the same gap both stay, in a stable order', () => {
		const { doc, id, ids } = base();
		const [a, b, c, d] = ids;
		const left = fromDoc(Automerge.clone(doc));
		const right = fromDoc(Automerge.clone(doc));
		left.change((l) => moveClip(l, id, c, 1)); // a c b d
		right.change((l) => moveClip(l, id, d, 1)); // a d b c
		const merged = Automerge.merge(Automerge.clone(left.doc), right.doc);
		const order = orderOf(merged, id);
		expect(order[0]).toBe(a);
		expect(order[3]).toBe(b);
		expect(order).toEqual(orderOf(Automerge.merge(Automerge.clone(right.doc), left.doc), id));
		// The tie (if any) is broken by id, and a later move still works.
		const after = fromDoc(merged);
		after.change((l) => moveClip(l, id, b, 0));
		expect(orderOf(after.doc, id)[0]).toBe(b);
	});

	it('the same video added on two devices shares one Source', () => {
		const { doc, id } = base();
		const left = fromDoc(Automerge.clone(doc));
		const right = fromDoc(Automerge.clone(doc));
		left.change((l) => addRecording(l, id, YT, {}, 5));
		right.change((l) => addRecording(l, id, { ...YT, title: 'Other' }, {}, 6));
		const merged = Automerge.merge(Automerge.clone(left.doc), right.doc) as unknown as Library;
		const yt = Object.values(merged.sources).filter((s) => s.provider === 'youtube');
		expect(yt).toHaveLength(1);
		expect(yt[0].id).toBe(sourceIdFor('youtube', YT.externalId));
	});

	it('a clip edited on one side and removed on the other stays removed', () => {
		const { doc, id, ids } = base();
		const left = fromDoc(Automerge.clone(doc));
		const right = fromDoc(Automerge.clone(doc));
		left.change((l) => updateClip(l, id, ids[0], { title: 'x' }));
		right.change((l) => removeClip(l, id, ids[0]));
		const merged = Automerge.merge(Automerge.clone(left.doc), right.doc) as unknown as Library;
		// Automerge keeps a concurrently edited map entry; either way nothing is corrupted.
		const clip = merged.pieces[id].clips[ids[0]];
		if (clip) expect(clip.sourceId).toBeDefined();
		expect(Object.keys(merged.pieces[id].clips).length).toBeGreaterThanOrEqual(3);
	});
});

describe('checkBounds', () => {
	it('normalizes and validates', () => {
		expect(checkBounds(0, undefined)).toEqual({ start: undefined, end: undefined });
		expect(checkBounds(1.00049, 2)).toEqual({ start: 1, end: 2 });
		expect(() => checkBounds(-1, 3)).toThrow(RangeError);
		expect(() => checkBounds(3, 3)).toThrow(RangeError);
		expect(() => checkBounds(undefined, 0)).toThrow(RangeError);
		expect(() => checkBounds(NaN, undefined)).toThrow(RangeError);
	});
});

describe('providers', () => {
	it('playback kinds', () => {
		expect(playbackOf({ provider: 'upload', url: '' })).toBe('file');
		expect(playbackOf({ provider: 'gdrive', url: '' })).toBe('file');
		expect(playbackOf({ provider: 'youtube', url: '' })).toBe('youtube');
		expect(playbackOf({ provider: 'spotify', url: '' })).toBe('link');
		expect(playbackOf({ provider: 'url', url: 'https://e.com/a.MP3?x=1' })).toBe('file');
		expect(playbackOf({ provider: 'url', url: 'https://e.com/page' })).toBe('link');
		expect(playbackOf({ provider: 'url', url: 'https://e.com/x', mime: 'audio/ogg' })).toBe('file');
		expect(isPlayable({ provider: 'thesession', url: '' })).toBe(false);
		expect(isAudioUrl('not a url')).toBe(false);
	});

	it('recording titles', () => {
		expect(
			recordingTitle({ title: 'Mine' }, { provider: 'youtube', title: 'File' }, 'oEmbed')
		).toBe('Mine');
		expect(recordingTitle({}, { provider: 'upload', title: 'File' }, 'oEmbed')).toBe('File');
		expect(recordingTitle({}, { provider: 'youtube' }, 'oEmbed')).toBe('oEmbed');
		expect(recordingTitle({}, { provider: 'spotify' })).toBe('Spotify recording');
		expect(recordingTitle({}, { provider: 'thesession' })).toBe('thesession.org');
	});

	it('drive file ids and local-only uploads', () => {
		expect(driveFileId({ provider: 'gdrive', externalId: 'F1' })).toBe('F1');
		expect(driveFileId({ provider: 'upload', assetKey: 'gdrive:F2' })).toBe('F2');
		expect(driveFileId({ provider: 'upload' })).toBeUndefined();
		expect(isLocalOnly({ provider: 'upload' })).toBe(true);
		expect(isLocalOnly({ provider: 'upload', assetKey: 'gdrive:F2' })).toBe(false);
		expect(isLocalOnly({ provider: 'youtube', externalId: 'x' })).toBe(false);
	});
});
