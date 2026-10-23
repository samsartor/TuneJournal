// Recordings: Sources (the underlying file or link) and Clips (a piece's possibly trimmed view of
// one), PLAN.md §5. Sources live at the library level and are shared by every clip that uses them;
// a clip only stores its own trim, title and key/first-notes overrides.
//
// Removing a clip never deletes its Source. Sources are tiny, an undo or another device's
// concurrent edit may still point at one, and M5's Split reuses them. `orphanSources` lists the
// unused ones, so the device-local audio cache can drop their bytes.

import { newId } from './id.ts';
import { normalizeKey } from './key.ts';
import { getPiece } from './ops.ts';
import { compareOrder, orderAfter, orderBetween } from './order.ts';
import { isInstrument } from './synth.ts';
import type {
	Clip,
	ClipId,
	Library,
	Piece,
	PieceId,
	Provider,
	Source,
	SourceId,
	Timestamp
} from './types.ts';

export class ClipNotFoundError extends Error {
	constructor(id: string) {
		super(`No clip with id ${id}`);
		this.name = 'ClipNotFoundError';
	}
}

export function getClip(lib: Library, pieceId: PieceId, clipId: ClipId): Clip {
	const clip = getPiece(lib, pieceId).clips[clipId];
	if (!clip) throw new ClipNotFoundError(clipId);
	return clip;
}

/** A piece's clips in display order: by fractional key, ties by id so every device agrees. */
export function sortedClips(piece: Pick<Piece, 'clips'>): Clip[] {
	return Object.values(piece.clips).sort(
		(a, b) => compareOrder(a.order, b.order) || compareOrder(a.id, b.id)
	);
}

// Sources

export interface NewSource {
	provider: Provider;
	url: string;
	/** Drive file id, YouTube video id, Spotify `track:…`, …; the dedupe key with `provider`. */
	externalId?: string;
	title?: string;
	durationSec?: number;
	mime?: string;
	assetKey?: string;
	/** Use this id for a new source, e.g. one whose bytes are already cached under it. */
	id?: SourceId;
}

/** The library's source for `provider` + `externalId`, oldest first if several exist. */
export function findSource(
	lib: Library,
	provider: Provider,
	externalId: string
): Source | undefined {
	let found: Source | undefined;
	for (const source of Object.values(lib.sources)) {
		if (source.provider !== provider || source.externalId !== externalId) continue;
		if (
			!found ||
			source.addedAt < found.addedAt ||
			(source.addedAt === found.addedAt && source.id < found.id)
		) {
			found = source;
		}
	}
	return found;
}

/**
 * The id for a new source. Sources with an external id get a deterministic one
 * (`youtube:dQw4w9WgXcQ`), so the same video added on two devices at once merges into one Source,
 * as thesession links do. Files without one get a random id.
 */
export function sourceIdFor(provider: Provider, externalId?: string): SourceId {
	return (externalId ? `${provider}:${externalId}` : newId()) as SourceId;
}

export interface SourcePatch {
	/** Can be replaced (e.g. by a Drive link after a backup) but never cleared. */
	url?: string;
	title?: string | null;
	durationSec?: number | null;
	mime?: string | null;
	assetKey?: string | null;
}

/** Changes a source's metadata. `null` or a blank string clears a field. */
export function updateSource(lib: Library, id: SourceId, patch: SourcePatch): boolean {
	const source = lib.sources[id];
	if (!source) throw new RangeError(`No source with id ${id}`);
	let changed = false;
	for (const [field, raw] of Object.entries(patch) as [keyof SourcePatch, unknown][]) {
		if (raw === undefined) continue;
		let value = raw as string | number | null;
		if (typeof value === 'string') value = value.trim() || null;
		if (field === 'durationSec' && value !== null) {
			if (typeof value !== 'number' || !(value > 0) || !Number.isFinite(value)) continue;
			value = roundTime(value);
		}
		if (value === null) {
			if (field === 'url') continue;
			if (field in source) {
				delete source[field];
				changed = true;
			}
		} else if (source[field] !== value) {
			(source as unknown as Record<string, unknown>)[field] = value;
			changed = true;
		}
	}
	return changed;
}

/** Sources no live or deleted piece has a clip for. */
export function orphanSources(lib: Library): Source[] {
	const used = new Set<string>();
	for (const piece of Object.values(lib.pieces)) {
		for (const clip of Object.values(piece.clips)) used.add(clip.sourceId);
	}
	return Object.values(lib.sources).filter((s) => !used.has(s.id));
}

/**
 * The library's source for `init`, found by provider + external id (or `init.id`), else created.
 * An existing source only gets the fields it lacks filled in; nothing is overwritten.
 */
export function ensureSource(
	lib: Library,
	init: NewSource,
	now: Timestamp = Date.now()
): { source: Source; created: boolean } {
	let source = init.externalId ? findSource(lib, init.provider, init.externalId) : undefined;
	if (!source && init.id) source = lib.sources[init.id];
	const created = !source;
	if (!source) {
		const id = init.id ?? sourceIdFor(init.provider, init.externalId);
		const fresh: Source = { id, provider: init.provider, url: init.url, addedAt: now };
		lib.sources[id] = fresh;
		source = lib.sources[id];
	}
	updateSource(lib, source.id, {
		title: source.title === undefined ? init.title : undefined,
		durationSec: source.durationSec === undefined ? init.durationSec : undefined,
		mime: source.mime === undefined ? init.mime : undefined,
		assetKey: source.assetKey === undefined ? init.assetKey : undefined
	});
	if (source.externalId === undefined && init.externalId) source.externalId = init.externalId;
	return { source, created };
}

// Clips

export interface ClipFields {
	start?: number;
	end?: number;
	title?: string;
	key?: string;
	firstNotes?: string;
	note?: string;
}

export interface AddRecordingResult {
	sourceId: SourceId;
	clipId: ClipId;
	/** A new Source was created (false when an existing one was reused). */
	newSource: boolean;
	/** A new Clip was added (false when the piece already had this exact clip). */
	newClip: boolean;
}

/**
 * Attaches a recording to a piece: finds or creates the Source (deduped by provider + external
 * id) and adds a Clip on it, last. If the piece already has a clip of that source with the same
 * trim, that clip is returned instead of adding a second one.
 */
export function addRecording(
	lib: Library,
	pieceId: PieceId,
	init: NewSource,
	fields: ClipFields = {},
	now: Timestamp = Date.now()
): AddRecordingResult {
	const piece = getPiece(lib, pieceId);
	const { source, created: newSource } = ensureSource(lib, init, now);

	const bounds = checkBounds(fields.start, fields.end);
	const existing = Object.values(piece.clips).find(
		(c) => c.sourceId === source.id && c.start === bounds.start && c.end === bounds.end
	);
	if (existing) {
		return { sourceId: source.id, clipId: existing.id, newSource, newClip: false };
	}

	const id = newId() as ClipId;
	const clip: Clip = {
		id,
		sourceId: source.id,
		order: orderAfter(Object.values(piece.clips).map((c) => c.order)),
		addedAt: now
	};
	if (bounds.start !== undefined) clip.start = bounds.start;
	if (bounds.end !== undefined) clip.end = bounds.end;
	piece.clips[id] = clip;
	updateClip(
		lib,
		pieceId,
		id,
		{ title: fields.title, key: fields.key, firstNotes: fields.firstNotes, note: fields.note },
		now
	);
	piece.modifiedAt = now;
	return { sourceId: source.id, clipId: id, newSource, newClip: true };
}

/**
 * Field changes for updateClip. `null` or a blank string clears a field; a field that's left out
 * is untouched. `start: 0` is the same as no start.
 */
export interface ClipPatch {
	start?: number | null;
	end?: number | null;
	title?: string | null;
	/** Key as played in this recording; normalized like piece keys. */
	key?: string | null;
	firstNotes?: string | null;
	note?: string | null;
	/** A synthesized recording's instrument override (an InstrumentId); null = its profile's. */
	instrument?: string | null;
}

/** Seconds, to the millisecond. */
function roundTime(t: number): number {
	return Math.round(t * 1000) / 1000;
}

/** Validates and normalizes a trim: start ≥ 0 (0 = absent), end > start. */
export function checkBounds(
	start: number | null | undefined,
	end: number | null | undefined
): { start?: number; end?: number } {
	const s = start == null ? undefined : roundTime(start);
	const e = end == null ? undefined : roundTime(end);
	if (s !== undefined && (!Number.isFinite(s) || s < 0)) {
		throw new RangeError(`Clip start must be a time ≥ 0, got ${start}`);
	}
	if (e !== undefined && (!Number.isFinite(e) || e <= 0)) {
		throw new RangeError(`Clip end must be a time > 0, got ${end}`);
	}
	if (s !== undefined && e !== undefined && e <= s) {
		throw new RangeError(`Clip end (${e}) must be after its start (${s})`);
	}
	return { start: s === 0 ? undefined : s, end: e };
}

const TEXT_FIELDS = ['title', 'firstNotes', 'note'] as const;

/** Applies a patch to a clip and bumps the piece's modifiedAt if anything changed. */
export function updateClip(
	lib: Library,
	pieceId: PieceId,
	clipId: ClipId,
	patch: ClipPatch,
	now: Timestamp = Date.now()
): boolean {
	const piece = getPiece(lib, pieceId);
	const clip = getClip(lib, pieceId, clipId);
	let changed = false;
	const set = (field: keyof Clip, value: string | number | undefined) => {
		if (value === undefined) {
			if (!(field in clip)) return;
			delete clip[field];
		} else {
			if (clip[field] === value) return;
			(clip as unknown as Record<string, unknown>)[field] = value;
		}
		changed = true;
	};

	if ('start' in patch || 'end' in patch) {
		const bounds = checkBounds(
			'start' in patch ? patch.start : clip.start,
			'end' in patch ? patch.end : clip.end
		);
		set('start', bounds.start);
		set('end', bounds.end);
	}
	for (const field of TEXT_FIELDS) {
		if (field in patch) set(field, clean(patch[field], field !== 'note'));
	}
	if ('key' in patch) set('key', patch.key ? normalizeKey(patch.key) : undefined);
	if ('instrument' in patch)
		set('instrument', isInstrument(patch.instrument) ? patch.instrument : undefined);

	if (changed) piece.modifiedAt = now;
	return changed;
}

function clean(text: string | null | undefined, collapse: boolean): string | undefined {
	const trimmed = text?.trim();
	return (collapse ? trimmed?.replace(/\s+/g, ' ') : trimmed) || undefined;
}

/** Removes a clip and returns a plain copy of it, for undo. */
export function removeClip(
	lib: Library,
	pieceId: PieceId,
	clipId: ClipId,
	now: Timestamp = Date.now()
): Clip | undefined {
	const piece = getPiece(lib, pieceId);
	const clip = piece.clips[clipId];
	if (!clip) return undefined;
	const copy = JSON.parse(JSON.stringify(clip)) as Clip;
	delete piece.clips[clipId];
	piece.modifiedAt = now;
	return copy;
}

/** Puts a removed clip back, at its old position. */
export function restoreClip(
	lib: Library,
	pieceId: PieceId,
	clip: Clip,
	now: Timestamp = Date.now()
): void {
	const piece = getPiece(lib, pieceId);
	if (piece.clips[clip.id]) return;
	piece.clips[clip.id] = JSON.parse(JSON.stringify(clip)) as Clip;
	piece.modifiedAt = now;
}

/**
 * Moves a clip to position `index` among the piece's clips (0 = first), by giving it a fractional
 * key between its new neighbours. Only the moved clip changes, so concurrent moves of different
 * clips both apply, and concurrent moves of the same clip end up at one of the two places.
 * Returns whether anything changed.
 */
export function moveClip(
	lib: Library,
	pieceId: PieceId,
	clipId: ClipId,
	index: number,
	now: Timestamp = Date.now()
): boolean {
	const piece = getPiece(lib, pieceId);
	const clip = getClip(lib, pieceId, clipId);
	const sorted = sortedClips(piece);
	const from = sorted.findIndex((c) => c.id === clipId);
	const others = sorted.filter((c) => c.id !== clipId);
	const to = Math.max(0, Math.min(others.length, Math.trunc(index)));
	if (to === from) return false;
	const lower = to > 0 ? others[to - 1].order : null;
	// Skip neighbours that share the lower key (possible after concurrent edits).
	const upper = others.slice(to).find((c) => lower === null || c.order > lower)?.order ?? null;
	clip.order = orderBetween(lower, upper);
	piece.modifiedAt = now;
	return true;
}

/** Moves a clip up (-1) or down (+1) one place. */
export function moveClipBy(
	lib: Library,
	pieceId: PieceId,
	clipId: ClipId,
	delta: number,
	now: Timestamp = Date.now()
): boolean {
	const sorted = sortedClips(getPiece(lib, pieceId));
	const from = sorted.findIndex((c) => c.id === clipId);
	if (from < 0) throw new ClipNotFoundError(clipId);
	return moveClip(lib, pieceId, clipId, from + delta, now);
}

export interface RelinkOptions {
	/** A start time carried in the new link (a YouTube `t=`): becomes the clip's start. */
	start?: number;
	now?: Timestamp;
}

/**
 * Points a clip at another recording, e.g. after its link was corrected: finds or creates the
 * Source for `init` (as addRecording does) and moves the clip onto it. The old Source stays (other
 * clips may use it). The clip keeps its title, key, first notes and note. Its trim is kept unless
 * the new link carries a start time, which replaces the start (and drops an end before it).
 * Returns whether the clip changed.
 */
export function relinkClip(
	lib: Library,
	pieceId: PieceId,
	clipId: ClipId,
	init: NewSource,
	{ start, now = Date.now() }: RelinkOptions = {}
): boolean {
	const piece = getPiece(lib, pieceId);
	const clip = getClip(lib, pieceId, clipId);
	const { source } = ensureSource(lib, init, now);
	let changed = false;
	if (clip.sourceId !== source.id) {
		clip.sourceId = source.id;
		changed = true;
	}
	if (start !== undefined && start > 0 && clip.start !== roundTime(start)) {
		const end = clip.end !== undefined && clip.end > start ? clip.end : null;
		updateClip(lib, pieceId, clipId, { start, end }, now);
		changed = true;
	}
	if (changed) piece.modifiedAt = now;
	return changed;
}
