// Links between pieces, and merging two pieces into one (PLAN.md §5, §6.4).

import { newId } from './id.ts';
import { addTag, createPiece, getPiece, PieceNotFoundError, tagKey } from './ops.ts';
import { compareOrder, orderAfter, orderBetween } from './order.ts';
import { checkBounds, ClipNotFoundError } from './recordings.ts';
import type {
	Clip,
	ClipId,
	Library,
	Link,
	LinkId,
	Piece,
	PieceId,
	PieceKind,
	Timestamp
} from './types.ts';

export function linkId(parent: PieceId, child: PieceId): LinkId {
	return `${parent}:${child}` as LinkId;
}

export interface LinkOptions {
	/** Explicit position; by default the child goes after the parent's current children. */
	order?: string;
}

/**
 * Makes `child` a child of `parent`, last by default. Linking twice is a no-op that keeps the
 * existing position, and concurrent identical links merge, since the id is `${parent}:${child}`.
 * Returns the link id.
 */
export function linkPieces(
	lib: Library,
	parent: PieceId,
	child: PieceId,
	options: LinkOptions = {}
): LinkId {
	getPiece(lib, parent);
	getPiece(lib, child);
	if (parent === child) throw new RangeError('A piece can’t contain itself');
	const id = linkId(parent, child);
	if (lib.links[id]) return id;
	const order = options.order ?? orderAfter(childOrders(lib, parent));
	lib.links[id] = { id, parent, child, order };
	return id;
}

export function unlinkPieces(lib: Library, parent: PieceId, child: PieceId): boolean {
	const id = linkId(parent, child);
	if (!lib.links[id]) return false;
	delete lib.links[id];
	return true;
}

function childOrders(lib: Library, parent: PieceId): string[] {
	return Object.values(lib.links)
		.filter((l) => l.parent === parent)
		.map((l) => l.order);
}

/** Links sorted by position, ties broken by id so every device agrees. */
export function sortLinks(links: Link[]): Link[] {
	return links.sort((a, b) => compareOrder(a.order, b.order) || compareOrder(a.id, b.id));
}

/**
 * The piece an id refers to now, following `mergedInto` redirects (PLAN.md §6.4). Stops at a
 * missing target or a cycle (two devices merging each way at once) and returns the last piece
 * reached. Undefined if `id` itself is unknown.
 */
export function resolvePiece(lib: Library, id: PieceId): Piece | undefined {
	let piece = lib.pieces[id];
	const seen = new Set<PieceId>();
	while (piece?.mergedInto && !seen.has(piece.id)) {
		seen.add(piece.id);
		const next = lib.pieces[piece.mergedInto];
		if (!next) break;
		piece = next;
	}
	return piece;
}

// Merge

/** Fields the merge confirm dialog lets the user pick from either piece. */
export const MERGE_FIELDS = ['title', 'kind', 'description', 'key', 'firstNotes'] as const;
export type MergeField = (typeof MERGE_FIELDS)[number];

export interface MergeOptions {
	/**
	 * Which piece each field comes from. Unset fields come from the survivor, or for everything but
	 * `kind`, from the first loser that has a value when the survivor has none.
	 */
	fields?: Partial<Record<MergeField, PieceId>>;
	now?: Timestamp;
}

export class MergeError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'MergeError';
	}
}

/**
 * Merges `losers` into `survivor` (PLAN.md §6.4). The survivor gains the union of tags, clips,
 * links (re-pointed and deduped), practice entries (in time order) and external IDs; favorite is
 * OR-ed and skill is the max. Title, kind, description, key and first notes follow
 * `options.fields`. Each loser gets `mergedInto` and `deletedAt`, so lookups of it redirect.
 *
 * Ids are resolved through earlier merges first, so merging into a piece that was itself merged
 * away lands on its survivor.
 */
export function mergePieces(
	lib: Library,
	survivorId: PieceId,
	losers: PieceId | PieceId[],
	options: MergeOptions = {}
): PieceId {
	const now = options.now ?? Date.now();
	const survivor = resolvePiece(lib, survivorId);
	if (!survivor) throw new PieceNotFoundError(survivorId);
	const loserPieces: Piece[] = [];
	for (const id of Array.isArray(losers) ? losers : [losers]) {
		const loser = lib.pieces[id];
		if (!loser) throw new PieceNotFoundError(id);
		if (loser.id === survivor.id) throw new MergeError('Can’t merge a piece into itself');
		if (resolvePiece(lib, id)?.id === survivor.id && loser.mergedInto) continue; // done already
		if (!loserPieces.includes(loser)) loserPieces.push(loser);
	}
	if (loserPieces.length === 0) return survivor.id;
	// Read the picked values before anything changes.
	const picked = pickFields(lib, survivor, loserPieces, options.fields ?? {});

	for (const loser of loserPieces) {
		for (const tag of Object.keys(loser.tags)) addTag(lib, survivor.id, tag, now);
		mergeClips(survivor, loser);
		mergePractice(survivor, loser);
		mergeExternal(survivor, loser);
		if (loser.favorite && !survivor.favorite) survivor.favorite = true;
		if (loser.skill !== undefined && (survivor.skill ?? 0) < loser.skill) {
			survivor.skill = loser.skill;
		}
		repointLinks(lib, loser.id, survivor.id);
		loser.mergedInto = survivor.id;
		if (loser.deletedAt === undefined) loser.deletedAt = now;
	}

	for (const field of MERGE_FIELDS) {
		const value = picked[field];
		if (value === undefined) {
			if (field !== 'kind' && field in survivor) delete survivor[field];
		} else if (survivor[field] !== value) {
			(survivor as unknown as Record<string, unknown>)[field] = value;
		}
	}
	survivor.modifiedAt = now;
	return survivor.id;
}

function pickFields(
	lib: Library,
	survivor: Piece,
	losers: Piece[],
	choice: Partial<Record<MergeField, PieceId>>
): Partial<Pick<Piece, MergeField>> {
	const involved = new Set([survivor.id, ...losers.map((l) => l.id)]);
	const result: Partial<Pick<Piece, MergeField>> = {};
	for (const field of MERGE_FIELDS) {
		const from = choice[field];
		let source: Piece | undefined;
		if (from !== undefined) {
			if (!involved.has(from)) throw new MergeError(`${from} isn’t part of this merge`);
			source = lib.pieces[from];
		} else if (field === 'kind' || survivor[field] !== undefined) {
			source = survivor;
		} else {
			source = losers.find((l) => l[field] !== undefined) ?? survivor;
		}
		const value = source?.[field];
		if (value !== undefined) (result as Record<string, unknown>)[field] = value;
	}
	return result;
}

function sameClip(a: Clip, b: Clip): boolean {
	return a.sourceId === b.sourceId && a.start === b.start && a.end === b.end;
}

/** Adds the loser's clips after the survivor's, skipping ones it already has. */
function mergeClips(survivor: Piece, loser: Piece) {
	const incoming = Object.values(loser.clips).sort(
		(a, b) => compareOrder(a.order, b.order) || compareOrder(a.id, b.id)
	);
	for (const clip of incoming) {
		const existing = Object.values(survivor.clips);
		if (survivor.clips[clip.id] || existing.some((c) => sameClip(c, clip))) continue;
		const copy = structuredClone(plainClip(clip));
		copy.order = orderAfter(existing.map((c) => c.order));
		survivor.clips[clip.id as ClipId] = copy;
	}
}

/** A plain copy of a clip, since structuredClone can't copy an Automerge proxy. */
function plainClip(clip: Clip): Clip {
	return JSON.parse(JSON.stringify(clip)) as Clip;
}

function samePractice(a: Piece['practice'][number], b: Piece['practice'][number]): boolean {
	return a.at === b.at && a.via === b.via && a.skillAfter === b.skillAfter;
}

/**
 * Inserts the loser's practice entries into the survivor's log in time order. Entries the survivor
 * already has (from the same merge done on another device) are skipped; the index also dedupes
 * them, for merges that happen concurrently.
 */
function mergePractice(survivor: Piece, loser: Piece) {
	for (const entry of loser.practice) {
		const log = survivor.practice;
		if (log.some((e) => samePractice(e, entry))) continue;
		let at = log.length;
		while (at > 0 && log[at - 1].at > entry.at) at--;
		const copy: Piece['practice'][number] = { at: entry.at };
		if (entry.via !== undefined) copy.via = entry.via;
		if (entry.skillAfter !== undefined) copy.skillAfter = entry.skillAfter;
		log.splice(at, 0, copy);
	}
}

/** External ids the survivor lacks are filled in from the loser; the survivor's own win. */
function mergeExternal(survivor: Piece, loser: Piece) {
	const from = loser.external;
	if (!from) return;
	if (from.thesession) {
		survivor.external ??= {};
		survivor.external.thesession ??= {};
		const into = survivor.external.thesession;
		for (const field of ['tuneId', 'settingId', 'setId', 'sessionId'] as const) {
			const value = from.thesession[field];
			if (value !== undefined && into[field] === undefined) into[field] = value;
		}
	}
	if (from.folkfriend && !survivor.external?.folkfriend) {
		survivor.external ??= {};
		survivor.external.folkfriend = { id: from.folkfriend.id };
	}
}

/**
 * Moves every link that touches `from` over to `to`. A link that would join `to` to itself is
 * dropped, and one that already exists keeps its current position.
 */
function repointLinks(lib: Library, from: PieceId, to: PieceId) {
	for (const link of Object.values(lib.links)) {
		if (link.parent !== from && link.child !== from) continue;
		const parent = link.parent === from ? to : link.parent;
		const child = link.child === from ? to : link.child;
		const order = link.order;
		delete lib.links[link.id];
		if (parent === child) continue;
		const id = linkId(parent, child);
		if (!lib.links[id]) lib.links[id] = { id, parent, child, order };
	}
}

// Editing links (M5)

/** The kind a parent conventionally contains (PLAN.md §5): Session ⊃ Set ⊃ Tune ⊃ Part. */
export const CHILD_KIND: Record<PieceKind, PieceKind> = {
	session: 'set',
	set: 'tune',
	tune: 'part',
	part: 'part'
};

/** Why a link can't or shouldn't be made: itself, already there, or it closes a loop. */
export type LinkProblem = 'self' | 'exists' | 'cycle';

/**
 * Checks a proposed parent → child link. `self` and `exists` are refused by the UI; `cycle` (the
 * parent is already inside the child, directly or further down) is allowed by the data model,
 * since nothing enforces a hierarchy, but the UI warns first.
 */
export function linkProblem(
	lib: Library,
	parent: PieceId,
	child: PieceId
): LinkProblem | undefined {
	const p = resolvePiece(lib, parent)?.id ?? parent;
	const c = resolvePiece(lib, child)?.id ?? child;
	if (p === c) return 'self';
	if (lib.links[linkId(p, c)]) return 'exists';
	if (isDescendant(lib, p, c)) return 'cycle';
	return undefined;
}

/** Whether `target` is reachable from `from` by walking child links (cycle-safe). */
function isDescendant(lib: Library, target: PieceId, from: PieceId): boolean {
	const byParent = new Map<PieceId, PieceId[]>();
	for (const link of Object.values(lib.links)) {
		const list = byParent.get(link.parent);
		if (list) list.push(link.child);
		else byParent.set(link.parent, [link.child]);
	}
	const seen = new Set<PieceId>([from]);
	const queue = [from];
	while (queue.length > 0) {
		for (const next of byParent.get(queue.pop()!) ?? []) {
			if (next === target) return true;
			if (!seen.has(next)) {
				seen.add(next);
				queue.push(next);
			}
		}
	}
	return false;
}

/** A parent's links in display order. */
export function childLinks(lib: Library, parent: PieceId): Link[] {
	return sortLinks(Object.values(lib.links).filter((l) => l.parent === parent));
}

/**
 * Moves a child to position `index` among its parent's children (0 = first), by giving only its
 * link a new fractional key, as moveClip does for clips. Returns whether anything changed.
 */
export function moveChild(lib: Library, parent: PieceId, child: PieceId, index: number): boolean {
	const others = childLinks(lib, parent).filter((l) => l.child !== child);
	const to = Math.max(0, Math.min(others.length, Math.trunc(index)));
	return moveChildAfter(lib, parent, child, to > 0 ? others[to - 1].child : null);
}

/**
 * Moves a child to just after the sibling `after` (null = first). The UI uses this, since it
 * lists only live children while links to deleted pieces keep their places. Returns whether
 * anything changed; an unknown `after` changes nothing.
 */
export function moveChildAfter(
	lib: Library,
	parent: PieceId,
	child: PieceId,
	after: PieceId | null
): boolean {
	const link = lib.links[linkId(parent, child)];
	if (!link) throw new RangeError(`${child} isn’t a child of ${parent}`);
	const sorted = childLinks(lib, parent);
	const others = sorted.filter((l) => l.child !== child);
	const to = after === null ? 0 : others.findIndex((l) => l.child === after) + 1;
	if (after !== null && to === 0) return false;
	if (sorted.findIndex((l) => l.child === child) === to) return false;
	const lower = to > 0 ? others[to - 1].order : null;
	// Skip neighbours that share the lower key (possible after concurrent edits).
	const upper = others.slice(to).find((l) => lower === null || l.order > lower)?.order ?? null;
	link.order = orderBetween(lower, upper);
	return true;
}

/** Moves a child up (-1) or down (+1) one place. */
export function moveChildBy(lib: Library, parent: PieceId, child: PieceId, delta: number): boolean {
	const from = childLinks(lib, parent).findIndex((l) => l.child === child);
	if (from < 0) throw new RangeError(`${child} isn’t a child of ${parent}`);
	return moveChild(lib, parent, child, from + delta);
}

/** Removes a link and returns a plain copy of it, for undo. The pieces are untouched. */
export function removeLink(lib: Library, parent: PieceId, child: PieceId): Link | undefined {
	const link = lib.links[linkId(parent, child)];
	if (!link) return undefined;
	const copy: Link = { id: link.id, parent: link.parent, child: link.child, order: link.order };
	delete lib.links[link.id];
	return copy;
}

/** Puts a removed link back at its old position (a no-op if it's back already). */
export function restoreLink(lib: Library, link: Link): void {
	if (lib.links[link.id]) return;
	lib.links[link.id] = { id: link.id, parent: link.parent, child: link.child, order: link.order };
}

export interface NewChild {
	/** Defaults to the parent's conventional child kind. */
	kind?: PieceKind;
	title?: string;
	now?: Timestamp;
	id?: PieceId;
}

/** Creates a piece and links it as the parent's last child. Returns the new piece's id. */
export function addChild(lib: Library, parent: PieceId, init: NewChild = {}): PieceId {
	const kind = init.kind ?? CHILD_KIND[getPiece(lib, parent).kind];
	const id = createPiece(lib, { kind, title: init.title, now: init.now, id: init.id });
	linkPieces(lib, parent, id);
	return id;
}

// Split (PLAN.md §6.4)

export interface SplitInput extends NewChild {
	/** The parent's clip to split from. Without it, the child is blank. */
	clipId?: ClipId;
	/**
	 * The region, in seconds of the source; `null` means the start (or end) of the recording.
	 * Left out, each bound is the parent clip's own.
	 */
	start?: number | null;
	end?: number | null;
}

export interface SplitResult {
	pieceId: PieceId;
	/** The new child's clip, on the same Source as the parent's. */
	clipId?: ClipId;
}

/**
 * Splits a region of one of the parent's clips into a new child piece: the child (of the
 * conventional child kind) gets a clip on the **same Source** with the region's bounds, and is
 * linked last under the parent. The Source is never copied. With no clip it adds a blank child.
 */
export function splitPiece(lib: Library, parent: PieceId, input: SplitInput = {}): SplitResult {
	const now = input.now ?? Date.now();
	const parentPiece = getPiece(lib, parent);
	let from: Clip | undefined;
	if (input.clipId !== undefined) {
		from = parentPiece.clips[input.clipId];
		if (!from) throw new ClipNotFoundError(input.clipId);
		if (!lib.sources[from.sourceId]) throw new RangeError(`No source with id ${from.sourceId}`);
	}
	// Checked before anything is written.
	const bounds = from
		? checkBounds(
				input.start === undefined ? from.start : input.start,
				input.end === undefined ? from.end : input.end
			)
		: { start: undefined, end: undefined };
	const pieceId = addChild(lib, parent, {
		kind: input.kind,
		title: input.title,
		id: input.id,
		now
	});
	if (!from) return { pieceId };
	const piece = getPiece(lib, pieceId);
	const clipId = newId() as ClipId;
	const clip: Clip = { id: clipId, sourceId: from.sourceId, order: orderAfter([]), addedAt: now };
	if (bounds.start !== undefined) clip.start = bounds.start;
	if (bounds.end !== undefined) clip.end = bounds.end;
	// The recording's per-clip key carries over; the title doesn't (the child has its own name).
	if (from.key !== undefined) clip.key = from.key;
	piece.clips[clipId] = clip;
	return { pieceId, clipId };
}

// Merge undo

/**
 * What `undoMerge` needs to put a merge back: plain copies of the pieces and of every link that
 * touched them, taken just before the merge.
 */
export interface MergeUndo {
	survivor: PieceId;
	pieces: Piece[];
	links: Link[];
}

/** mergePieces, plus a snapshot to undo it with. */
export function mergeWithUndo(
	lib: Library,
	survivorId: PieceId,
	losers: PieceId | PieceId[],
	options: MergeOptions = {}
): { id: PieceId; undo: MergeUndo } {
	const survivor = resolvePiece(lib, survivorId);
	if (!survivor) throw new PieceNotFoundError(survivorId);
	const ids = new Set<PieceId>([survivor.id, ...(Array.isArray(losers) ? losers : [losers])]);
	const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
	const undo: MergeUndo = {
		survivor: survivor.id,
		pieces: [...ids].filter((id) => lib.pieces[id]).map((id) => plain(lib.pieces[id])),
		links: Object.values(lib.links)
			.filter((l) => ids.has(l.parent) || ids.has(l.child))
			.map((l) => plain(l))
	};
	const id = mergePieces(lib, survivorId, losers, options);
	return { id, undo };
}

/**
 * Reverses a merge from its snapshot. Losers lose `mergedInto` (and `deletedAt`, unless they were
 * deleted before), their links come back and the re-pointed copies go. The survivor gets back its
 * own scalar fields, and loses the tags, clips and practice entries the merge brought in; anything
 * else added to it since the merge (a new practice entry, a new clip) stays.
 */
export function undoMerge(lib: Library, undo: MergeUndo, now: Timestamp = Date.now()): void {
	const before = new Map(undo.pieces.map((p) => [p.id, p]));
	const old = before.get(undo.survivor);
	const survivor = lib.pieces[undo.survivor];
	if (!old || !survivor) return;
	const losers = undo.pieces.filter((p) => p.id !== undo.survivor);

	for (const loser of losers) {
		const piece = lib.pieces[loser.id];
		if (!piece) continue;
		if (loser.mergedInto === undefined) delete piece.mergedInto;
		else piece.mergedInto = loser.mergedInto;
		if (loser.deletedAt === undefined) delete piece.deletedAt;
		else piece.deletedAt = loser.deletedAt;
	}

	// Tags, clips and practice the losers brought in.
	const oldTags = new Set(Object.keys(old.tags).map(tagKey));
	const loserTags = new Set(losers.flatMap((l) => Object.keys(l.tags).map(tagKey)));
	for (const tag of Object.keys(survivor.tags)) {
		if (!oldTags.has(tagKey(tag)) && loserTags.has(tagKey(tag))) delete survivor.tags[tag];
	}
	const loserClips = new Set(losers.flatMap((l) => Object.keys(l.clips)));
	for (const id of Object.keys(survivor.clips) as ClipId[]) {
		if (!old.clips[id] && loserClips.has(id)) delete survivor.clips[id];
	}
	const loserPractice = losers.flatMap((l) => l.practice);
	for (let i = survivor.practice.length - 1; i >= 0; i--) {
		const entry = survivor.practice[i];
		const brought = loserPractice.some((e) => samePractice(e, entry));
		const own = old.practice.filter((e) => samePractice(e, entry)).length;
		const kept = survivor.practice.filter((e) => samePractice(e, entry)).length;
		if (brought && kept > own) survivor.practice.splice(i, 1);
	}

	// Scalars as they were.
	for (const field of [...MERGE_FIELDS, 'skill'] as const) {
		const value = old[field];
		if (value === undefined) {
			if (field in survivor) delete survivor[field];
		} else if (survivor[field] !== value) {
			(survivor as unknown as Record<string, unknown>)[field] = value;
		}
	}
	if (survivor.favorite !== old.favorite) survivor.favorite = old.favorite;
	if (old.external === undefined) {
		if ('external' in survivor) delete survivor.external;
	} else if (JSON.stringify(survivor.external) !== JSON.stringify(old.external)) {
		survivor.external = old.external;
	}

	// Links: drop the re-pointed ones, put the old ones back where they were.
	const ids = new Set(undo.pieces.map((p) => p.id));
	const oldLinks = new Map(undo.links.map((l) => [l.id, l]));
	for (const link of Object.values(lib.links)) {
		if (!ids.has(link.parent) && !ids.has(link.child)) continue;
		if (!oldLinks.has(link.id)) delete lib.links[link.id];
	}
	for (const link of undo.links) {
		const current = lib.links[link.id];
		if (!current) restoreLink(lib, link);
		else if (current.order !== link.order) current.order = link.order;
	}
	survivor.modifiedAt = now;
}
