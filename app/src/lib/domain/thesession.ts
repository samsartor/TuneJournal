// Ops that tie pieces to thesession.org (PLAN.md §6.3, §6.4). They take plain data picked from the
// integration layer, and store only ids plus what the user chose: title, a type tag, a link-only
// Source, and the picked setting's key and first notes, which go on the thesession recording (the
// link's clip), not on the piece. The piece shows them through effectiveKey/effectiveFirstNotes
// until it gets its own (PLAN.md §5, §13).

import { normalizeKey } from './key.ts';
import { addTag, createPiece, getPiece, updatePiece } from './ops.ts';
import { orderAfter } from './order.ts';
import { updateClip, type ClipPatch } from './recordings.ts';
import { linkPieces } from './relations.ts';
import type { ClipId, Library, Piece, PieceId, Source, SourceId, Timestamp } from './types.ts';

export const THESESSION_URL = 'https://thesession.org';

export interface TheSessionTuneInfo {
	tuneId: number;
	name: string;
	/** Lowercase thesession type, e.g. "slip jig". */
	type?: string;
	/** Defaults to https://thesession.org/tunes/{tuneId}. */
	url?: string;
}

export interface TheSessionSettingInfo {
	settingId: number;
	/** Any key text normalizeKey accepts, e.g. "Edorian" or "Edor". */
	key?: string;
	/** ABC of the opening bars. */
	firstNotes?: string;
}

const TYPE_TAGS: Record<string, string> = {
	reel: 'Reel',
	jig: 'Jig',
	'slip jig': 'Slip Jig',
	hornpipe: 'Hornpipe',
	polka: 'Polka',
	slide: 'Slide',
	waltz: 'Waltz',
	barndance: 'Barndance',
	strathspey: 'Strathspey',
	mazurka: 'Mazurka',
	'three-two': 'Three-Two'
};

/** The tag for a thesession tune type: "slip jig" → "Slip Jig", "three-two" → "Three-Two". */
export function typeTag(type: string): string | undefined {
	const key = type.trim().toLowerCase().replace(/\s+/g, ' ');
	if (!key) return undefined;
	return TYPE_TAGS[key] ?? key.replace(/(^|[\s-])(\p{L})/gu, (_, sep, c) => sep + c.toUpperCase());
}

export function tuneUrl(tuneId: number): string {
	return `${THESESSION_URL}/tunes/${tuneId}`;
}

/** Deterministic, so the same tune added on two devices (or two merged pieces) shares one. */
export function tuneSourceId(tuneId: number): SourceId {
	return `thesession:tune:${tuneId}` as SourceId;
}

export function setSourceId(setId: number): SourceId {
	return `thesession:set:${setId}` as SourceId;
}

/** Live pieces linked to a thesession tune, oldest first. */
export function piecesWithTune(lib: Library, tuneId: number): Piece[] {
	return Object.values(lib.pieces)
		.filter(
			(p) =>
				p.deletedAt === undefined &&
				p.mergedInto === undefined &&
				p.external?.thesession?.tuneId === tuneId
		)
		.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
}

/** Adds a link-only Source (shared by id) and a Clip on the piece pointing at it. */
function attachLink(
	lib: Library,
	piece: Piece,
	sourceId: SourceId,
	url: string,
	externalId: string,
	now: Timestamp
) {
	if (!lib.sources[sourceId]) {
		const source: Source = { id: sourceId, provider: 'thesession', url, externalId, addedAt: now };
		lib.sources[sourceId] = source;
	}
	const clipId = sourceId as string as ClipId;
	if (piece.clips[clipId]) return;
	const order = orderAfter(Object.values(piece.clips).map((c) => c.order));
	piece.clips[clipId] = { id: clipId, sourceId, order, addedAt: now };
}

export interface LinkTuneOptions {
	/** Replace a title that's already set. A blank title is always filled. */
	replaceTitle?: boolean;
	now?: Timestamp;
}

/**
 * Links a piece to a thesession tune (the 🔍 autofill, §6.3): sets the tune id, fills the title,
 * adds the type tag (in the library's existing casing) and a thesession link. Re-linking to another
 * tune drops the old tune's setting id and link.
 */
export function linkTheSessionTune(
	lib: Library,
	id: PieceId,
	tune: TheSessionTuneInfo,
	options: LinkTuneOptions = {}
): void {
	const now = options.now ?? Date.now();
	const piece = getPiece(lib, id);
	if (!piece.title || options.replaceTitle) updatePiece(lib, id, { title: tune.name }, now);
	if (tune.type) {
		const tag = typeTag(tune.type);
		if (tag) addTag(lib, id, tag, now);
	}

	const previous = piece.external?.thesession?.tuneId;
	if (previous !== undefined && previous !== tune.tuneId) {
		delete piece.clips[tuneClipId(previous)];
		if (piece.external?.thesession && 'settingId' in piece.external.thesession) {
			delete piece.external.thesession.settingId;
		}
	}
	piece.external ??= {};
	piece.external.thesession ??= {};
	if (piece.external.thesession.tuneId !== tune.tuneId) {
		piece.external.thesession.tuneId = tune.tuneId;
	}
	attachLink(
		lib,
		piece,
		tuneSourceId(tune.tuneId),
		tune.url ?? tuneUrl(tune.tuneId),
		String(tune.tuneId),
		now
	);
	piece.modifiedAt = now;
}

export interface ApplySettingOptions {
	/**
	 * Replace a key or first notes the thesession recording already has; otherwise only its blanks
	 * are filled.
	 */
	overwrite?: boolean;
	now?: Timestamp;
}

/** The clip of a piece's link to thesession tune `tuneId`. */
export function tuneClipId(tuneId: number): ClipId {
	return tuneSourceId(tuneId) as string as ClipId;
}

/**
 * Stores the chosen thesession setting, and writes its key and first notes to the piece's
 * thesession recording (the tune link's clip, re-added if it was removed). The piece's own key and
 * first notes are never touched: it inherits these until the user sets its own (PLAN.md §5).
 * Returns the clip written to, if the piece is linked to a tune.
 */
export function applyTheSessionSetting(
	lib: Library,
	id: PieceId,
	setting: TheSessionSettingInfo,
	options: ApplySettingOptions = {}
): ClipId | undefined {
	const now = options.now ?? Date.now();
	const piece = getPiece(lib, id);
	piece.external ??= {};
	piece.external.thesession ??= {};
	const ts = piece.external.thesession;
	if (ts.settingId !== setting.settingId) {
		ts.settingId = setting.settingId;
		piece.modifiedAt = now;
	}
	if (ts.tuneId === undefined) return undefined;
	const sourceId = tuneSourceId(ts.tuneId);
	attachLink(lib, piece, sourceId, tuneUrl(ts.tuneId), String(ts.tuneId), now);
	const clipId = tuneClipId(ts.tuneId);
	const clip = piece.clips[clipId];
	const key = setting.key ? normalizeKey(setting.key) : undefined;
	const firstNotes = setting.firstNotes?.trim().replace(/\s+/g, ' ') || undefined;
	const patch: ClipPatch = {};
	if (key && (options.overwrite || !clip.key)) patch.key = key;
	if (firstNotes && (options.overwrite || !clip.firstNotes)) patch.firstNotes = firstNotes;
	if (options.overwrite) {
		// A new setting replaces the old one's values, even where it has none of its own.
		if (!key) patch.key = null;
		if (!firstNotes) patch.firstNotes = null;
	}
	updateClip(lib, id, clipId, patch, now);
	return clipId;
}

/** Removes the thesession ids and link from a piece. Title, tags, key and notes stay. */
export function unlinkTheSession(lib: Library, id: PieceId, now: Timestamp = Date.now()): boolean {
	const piece = getPiece(lib, id);
	const ts = piece.external?.thesession;
	if (!ts) return false;
	if (ts.tuneId !== undefined) delete piece.clips[tuneSourceId(ts.tuneId) as string as ClipId];
	if (ts.setId !== undefined) delete piece.clips[setSourceId(ts.setId) as string as ClipId];
	delete piece.external!.thesession;
	if (Object.keys(piece.external!).length === 0) delete piece.external;
	piece.modifiedAt = now;
	return true;
}

// Promoting a suggested set (§6.4)

export interface TheSessionSetTune extends TheSessionTuneInfo {
	settingId?: number;
	/** Abbreviated key from the set, e.g. "Edor". */
	key?: string;
}

export interface TheSessionSetInfo {
	setId: number;
	/** The set's page on thesession.org. */
	url?: string;
	tunes: TheSessionSetTune[];
}

export interface PromoteResult {
	setId: PieceId;
	/** True when the set was already in the library and was reused. */
	existed: boolean;
	/** Tune pieces created for tunes the library didn't have. */
	created: PieceId[];
	/** Every tune piece in the set, in order. */
	tunes: PieceId[];
}

/** The live Set piece promoted from a thesession set, if any. */
export function pieceForSet(lib: Library, setId: number): Piece | undefined {
	return Object.values(lib.pieces).find(
		(p) =>
			p.deletedAt === undefined &&
			p.mergedInto === undefined &&
			p.external?.thesession?.setId === setId
	);
}

/** "Drowsy Maggie / The Kesh / Cooley's". */
export function setTitle(tunes: Pick<TheSessionTuneInfo, 'name'>[]): string {
	return tunes.map((t) => t.name).join(' / ');
}

/**
 * Turns a suggested thesession set into a Set piece with links to its tunes, in order. Tunes the
 * library already has (by tune id, oldest piece first) are reused; missing ones become new Tune
 * pieces with the title, type tag, setting, key and link filled in. Promoting the same set again
 * reuses the existing Set and adds any missing links.
 */
export function promoteTheSessionSet(
	lib: Library,
	set: TheSessionSetInfo,
	now: Timestamp = Date.now()
): PromoteResult {
	const existing = pieceForSet(lib, set.setId);
	const setId = existing?.id ?? createPiece(lib, { kind: 'set', title: setTitle(set.tunes), now });
	const setPiece = getPiece(lib, setId);
	if (!existing) {
		setPiece.external = { thesession: { setId: set.setId } };
		if (set.url)
			attachLink(lib, setPiece, setSourceId(set.setId), set.url, `set:${set.setId}`, now);
	}

	const created: PieceId[] = [];
	const tunes: PieceId[] = [];
	for (const tune of set.tunes) {
		let tuneId = piecesWithTune(lib, tune.tuneId)[0]?.id;
		if (!tuneId) {
			tuneId = createPiece(lib, { now });
			linkTheSessionTune(lib, tuneId, tune, { now });
			if (tune.settingId !== undefined) {
				applyTheSessionSetting(lib, tuneId, { settingId: tune.settingId, key: tune.key }, { now });
			}
			created.push(tuneId);
		}
		if (!tunes.includes(tuneId)) {
			linkPieces(lib, setId, tuneId);
			tunes.push(tuneId);
		}
	}
	return { setId, existed: !!existing, created, tunes };
}
