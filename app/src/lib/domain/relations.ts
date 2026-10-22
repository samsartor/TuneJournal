// Links between pieces, and merging two pieces into one (PLAN.md §5, §6.4).

import { addTag, getPiece, PieceNotFoundError } from './ops.ts';
import { compareOrder, orderAfter } from './order.ts';
import type { Clip, ClipId, Library, Link, LinkId, Piece, PieceId, Timestamp } from './types.ts';

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
