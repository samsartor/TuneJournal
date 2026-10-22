// Mutations on the Library (PLAN.md §5). Each takes a mutable Library, so the same code runs inside
// `handle.change(d => ...)` and on plain objects in tests. Optional fields are cleared with
// `delete`, never by assigning undefined, which Automerge rejects.

import { newId } from './id.ts';
import { normalizeKey } from './key.ts';
import type {
	Library,
	ListSettings,
	Piece,
	PieceId,
	PieceKind,
	PracticeEntry,
	Settings,
	Skill,
	Timestamp
} from './types.ts';

export class PieceNotFoundError extends Error {
	constructor(id: string) {
		super(`No piece with id ${id}`);
		this.name = 'PieceNotFoundError';
	}
}

export function getPiece(lib: Library, id: PieceId): Piece {
	const piece = lib.pieces[id];
	if (!piece) throw new PieceNotFoundError(id);
	return piece;
}

export interface NewPiece {
	kind?: PieceKind;
	title?: string;
	now?: Timestamp;
	id?: PieceId;
}

/** Adds a blank piece (a Tune by default) and returns its id. */
export function createPiece(lib: Library, init: NewPiece = {}): PieceId {
	const now = init.now ?? Date.now();
	const id = init.id ?? (newId() as PieceId);
	const piece: Piece = {
		id,
		kind: init.kind ?? 'tune',
		tags: {},
		favorite: false,
		clips: {},
		practice: [],
		createdAt: now,
		modifiedAt: now
	};
	const title = clean(init.title);
	if (title) piece.title = title;
	lib.pieces[id] = piece;
	return id;
}

/**
 * Field changes for updatePiece. For optional fields, `null` or a blank string clears the value;
 * a field that's left out is untouched.
 */
export interface PiecePatch {
	kind?: PieceKind;
	title?: string | null;
	description?: string | null;
	key?: string | null;
	firstNotes?: string | null;
	skill?: Skill | null;
	favorite?: boolean;
}

/** Applies a patch and bumps modifiedAt if anything changed. Returns whether it did. */
export function updatePiece(
	lib: Library,
	id: PieceId,
	patch: PiecePatch,
	now: Timestamp = Date.now()
): boolean {
	const piece = getPiece(lib, id);
	let changed = false;

	if (patch.kind !== undefined && patch.kind !== piece.kind) {
		piece.kind = patch.kind;
		changed = true;
	}
	if (patch.favorite !== undefined && patch.favorite !== piece.favorite) {
		piece.favorite = patch.favorite;
		changed = true;
	}
	if ('title' in patch) changed = setOptional(piece, 'title', clean(patch.title)) || changed;
	if ('description' in patch) {
		// Keep the user's line breaks; only trim the ends.
		const text = patch.description?.trim() || undefined;
		changed = setOptional(piece, 'description', text) || changed;
	}
	if ('key' in patch) {
		changed = setOptional(piece, 'key', patch.key ? normalizeKey(patch.key) : undefined) || changed;
	}
	if ('firstNotes' in patch) {
		changed = setOptional(piece, 'firstNotes', clean(patch.firstNotes)) || changed;
	}
	if ('skill' in patch) {
		const skill = patch.skill == null ? undefined : checkSkill(patch.skill);
		changed = setOptional(piece, 'skill', skill) || changed;
	}

	if (changed) piece.modifiedAt = now;
	return changed;
}

type OptionalField = 'title' | 'description' | 'key' | 'firstNotes' | 'skill';

function setOptional<F extends OptionalField>(
	piece: Piece,
	field: F,
	value: Piece[F] | undefined
): boolean {
	if (value === undefined) {
		if (!(field in piece)) return false;
		delete piece[field];
		return true;
	}
	if (piece[field] === value) return false;
	piece[field] = value;
	return true;
}

function clean(text: string | null | undefined): string | undefined {
	return text?.trim().replace(/\s+/g, ' ') || undefined;
}

function checkSkill(skill: number): Skill {
	if (!Number.isInteger(skill) || skill < 1 || skill > 5) {
		throw new RangeError(`Skill must be an integer from 1 to 5, got ${skill}`);
	}
	return skill as Skill;
}

// Tags

/** Tags compare case- and whitespace-insensitively. */
export function tagKey(tag: string): string {
	return tag.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

/**
 * The spelling to store for a typed tag: the casing already used elsewhere in the library if
 * there is one, otherwise the text as typed (trimmed).
 */
export function canonicalTag(lib: Library, tag: string): string | undefined {
	const text = tag.trim().replace(/\s+/g, ' ');
	if (!text) return undefined;
	const key = tagKey(text);
	let best: string | undefined;
	let bestCreated = Infinity;
	for (const piece of Object.values(lib.pieces)) {
		for (const t of Object.keys(piece.tags)) {
			// The oldest piece's spelling wins, so concurrent devices converge on the same casing.
			if (tagKey(t) === key && piece.createdAt < bestCreated) {
				best = t;
				bestCreated = piece.createdAt;
			}
		}
	}
	return best ?? text;
}

/** Adds a tag unless the piece already has it in any casing. Returns the stored spelling. */
export function addTag(
	lib: Library,
	id: PieceId,
	tag: string,
	now: Timestamp = Date.now()
): string | undefined {
	const piece = getPiece(lib, id);
	const key = tagKey(tag);
	if (!key) return undefined;
	const existing = Object.keys(piece.tags).find((t) => tagKey(t) === key);
	if (existing) return existing;
	const spelling = canonicalTag(lib, tag)!;
	piece.tags[spelling] = true;
	piece.modifiedAt = now;
	return spelling;
}

/** Removes a tag in every casing (concurrent devices may have added several). */
export function removeTag(
	lib: Library,
	id: PieceId,
	tag: string,
	now: Timestamp = Date.now()
): boolean {
	const piece = getPiece(lib, id);
	const key = tagKey(tag);
	let changed = false;
	for (const t of Object.keys(piece.tags)) {
		if (tagKey(t) === key) {
			delete piece.tags[t];
			changed = true;
		}
	}
	if (changed) piece.modifiedAt = now;
	return changed;
}

// Practice

export interface PracticeInput {
	now?: Timestamp;
	via?: PracticeEntry['via'];
	/** Also sets the piece's skill, recorded on the entry as a snapshot. */
	skillAfter?: Skill;
}

/**
 * Appends a practice entry. Practice doesn't bump modifiedAt: "last practiced" covers it, and
 * "modified" stays about edits.
 */
export function logPractice(lib: Library, id: PieceId, input: PracticeInput = {}): PracticeEntry {
	const piece = getPiece(lib, id);
	const entry: PracticeEntry = { at: input.now ?? Date.now() };
	if (input.via) entry.via = input.via;
	if (input.skillAfter !== undefined) {
		entry.skillAfter = checkSkill(input.skillAfter);
		updatePiece(lib, id, { skill: entry.skillAfter }, entry.at);
	}
	piece.practice.push(entry);
	return entry;
}

/** Removes the entry logged at `at` (the undo for an accidental tap). */
export function unlogPractice(lib: Library, id: PieceId, at: Timestamp): boolean {
	const piece = getPiece(lib, id);
	for (let i = piece.practice.length - 1; i >= 0; i--) {
		if (piece.practice[i].at === at) {
			piece.practice.splice(i, 1);
			return true;
		}
	}
	return false;
}

// Deletion

export function softDelete(lib: Library, id: PieceId, now: Timestamp = Date.now()): void {
	const piece = getPiece(lib, id);
	if (piece.deletedAt === undefined) piece.deletedAt = now;
}

export function undoDelete(lib: Library, id: PieceId): void {
	const piece = getPiece(lib, id);
	if ('deletedAt' in piece) delete piece.deletedAt;
}

// Settings

/**
 * Merges list settings field by field, so concurrent changes to different fields both survive.
 * `undefined` in the patch clears an optional field.
 */
export function setListSettings(lib: Library, patch: Partial<ListSettings>): void {
	const list = lib.settings.list;
	for (const [field, value] of Object.entries(patch) as [keyof ListSettings, unknown][]) {
		if (value === undefined) {
			if (field in list) delete list[field];
		} else if (field === 'kinds' || field === 'tags') {
			const next = value as Record<string, boolean>;
			// Re-read after assigning: inside Automerge, the assigned literal isn't the live proxy.
			if (!list[field]) list[field] = {} as never;
			const current = list[field] as Record<string, boolean>;
			for (const k of Object.keys(current)) if (!(k in next)) delete current[k];
			for (const [k, v] of Object.entries(next)) if (current[k] !== v) current[k] = v;
		} else if (field === 'practiced') {
			const next = value as NonNullable<ListSettings['practiced']>;
			if (!list.practiced) list.practiced = { ...next };
			else {
				if (list.practiced.within !== next.within) list.practiced.within = next.within;
				if (list.practiced.days !== next.days) list.practiced.days = next.days;
			}
		} else if (list[field] !== value) {
			(list as unknown as Record<string, unknown>)[field] = value;
		}
	}
}

/**
 * Merges shuffle settings field by field (kinds key by key), like setListSettings, so concurrent
 * changes to different fields both survive. `respectListFilter: false` clears the flag.
 */
export function setShuffleSettings(lib: Library, patch: Partial<Settings['shuffle']>): void {
	const shuffle = lib.settings.shuffle;
	for (const [field, value] of Object.entries(patch) as [keyof Settings['shuffle'], unknown][]) {
		if (value === undefined) continue;
		if (field === 'kinds') {
			for (const [k, v] of Object.entries(value as Record<PieceKind, boolean>)) {
				if (shuffle.kinds[k as PieceKind] !== v) shuffle.kinds[k as PieceKind] = v;
			}
		} else if (field === 'respectListFilter') {
			if (value) shuffle.respectListFilter = true;
			else if ('respectListFilter' in shuffle) delete shuffle.respectListFilter;
		} else if (field === 'skillMin' || field === 'skillMax') {
			const skill = checkSkill(value as number);
			if (shuffle[field] !== skill) shuffle[field] = skill;
		} else if (shuffle[field] !== value) {
			(shuffle as unknown as Record<string, unknown>)[field] = value;
		}
	}
	// Keep the range the right way round.
	if (shuffle.skillMin > shuffle.skillMax) {
		if ('skillMin' in patch) shuffle.skillMax = shuffle.skillMin;
		else shuffle.skillMin = shuffle.skillMax;
	}
}
