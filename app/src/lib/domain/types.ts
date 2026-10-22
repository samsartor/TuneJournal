// Shapes of the synced Library doc (PLAN.md §5).
//
// Automerge rejects `undefined` values, so optional fields must be omitted (or deleted), never
// set to `undefined`. Write `delete piece.skill`, not `piece.skill = undefined`.

declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

export type PieceId = Brand<string, 'PieceId'>;
export type ClipId = Brand<string, 'ClipId'>;
export type SourceId = Brand<string, 'SourceId'>;
/** Always `${parent}:${child}`, so concurrent identical adds dedupe. */
export type LinkId = Brand<string, 'LinkId'>;

/** Epoch milliseconds. */
export type Timestamp = number;

export type PieceKind = 'session' | 'set' | 'tune' | 'part';

/** 1 = never played … 5 = amazing. Absent = unrated. */
export type Skill = 1 | 2 | 3 | 4 | 5;

export interface Library {
	schemaVersion: number;
	pieces: Record<PieceId, Piece>;
	sources: Record<SourceId, Source>;
	links: Record<LinkId, Link>;
	settings: Settings;
}

export interface Piece {
	id: PieceId;
	kind: PieceKind;
	title?: string;
	description?: string;
	tags: Record<string, true>;
	skill?: Skill;
	/** Usual key, normalized tonic + mode, e.g. "D major". Hidden for set/session. */
	key?: string;
	/** ABC snippet of the opening. Hidden for set/session. */
	firstNotes?: string;
	favorite: boolean;
	clips: Record<ClipId, Clip>;
	/** Append-only. */
	practice: PracticeEntry[];
	external?: {
		thesession?: { tuneId?: number; settingId?: number; setId?: number; sessionId?: number };
		folkfriend?: { id: string };
	};
	createdAt: Timestamp;
	modifiedAt: Timestamp;
	deletedAt?: Timestamp;
	/** Tombstone redirect after merge. */
	mergedInto?: PieceId;
}

/** A (possibly trimmed) view onto a Source. */
export interface Clip {
	id: ClipId;
	sourceId: SourceId;
	/** Fractional index within the piece. */
	order: string;
	/** Seconds; absent = beginning. */
	start?: number;
	/** Seconds; absent = end. */
	end?: number;
	title?: string;
	/** Overrides piece.key. */
	key?: string;
	/** Overrides piece.firstNotes. */
	firstNotes?: string;
	note?: string;
	addedAt: Timestamp;
}

export type Provider =
	'upload' | 'gdrive' | 'grecorder' | 'youtube' | 'spotify' | 'thesession' | 'folkfriend' | 'url';

/** The underlying asset or link, never trimmed. */
export interface Source {
	id: SourceId;
	provider: Provider;
	/** Canonical link; always openable as a fallback. */
	url: string;
	externalId?: string;
	title?: string;
	durationSec?: number;
	mime?: string;
	assetKey?: string;
	addedAt: Timestamp;
}

/** Parent "contains" child: session ⊃ set ⊃ tune ⊃ part, by convention only. */
export interface Link {
	id: LinkId;
	parent: PieceId;
	child: PieceId;
	/** Fractional index of the child within the parent. */
	order: string;
}

/** Only "Practiced" is logged; skipping persists nothing. */
export interface PracticeEntry {
	at: Timestamp;
	/** Snapshot when skill was changed in the same action. */
	skillAfter?: Skill;
	via?: 'card' | 'shuffle';
}

/** `null` = ∞ (the factor is ignored). Infinity isn't JSON-safe, so it's never stored. */
export type Temperature = number | null;

export type SortField =
	'title' | 'created' | 'modified' | 'lastPracticed' | 'timesPracticed' | 'skill';

export interface Settings {
	shuffle: {
		tAge: Temperature;
		tSkill: Temperature;
		tFav: Temperature;
		kinds: Record<PieceKind, boolean>;
		/** Inclusive; unrated counts as 1. */
		skillMin: Skill;
		skillMax: Skill;
	};
	list: ListSettings;
}

/**
 * The main list's last-used filter and sort. Every field except sort, descending and kinds is
 * optional; absent means "no constraint".
 */
export interface ListSettings {
	sort: SortField;
	descending: boolean;
	/** No kind selected shows every kind. */
	kinds: Record<PieceKind, boolean>;
	tags?: Record<string, true>;
	/** Default 'any'. */
	tagMode?: 'any' | 'all';
	/** Inclusive; unrated counts as 1 (PLAN.md §14). */
	skillMin?: Skill;
	skillMax?: Skill;
	unratedOnly?: boolean;
	/** Normalized key, matched exactly. */
	key?: string;
	favoritesOnly?: boolean;
	/** Practiced within the last N days, or (within = false) not within them. */
	practiced?: { within: boolean; days: number };
}
