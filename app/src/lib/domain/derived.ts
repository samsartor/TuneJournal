// Values derived from the Library, never stored (PLAN.md §5), plus list filter/sort/search.
//
// Practice and skill go through effectivePractice/effectiveSkill. In M1 they return the piece's
// own values; M5 adds the ancestor walk (practice) and Part → Tune inheritance (skill, key)
// there without touching the callers.

import { tagKey } from './ops.ts';
import type {
	Library,
	ListSettings,
	Piece,
	PieceId,
	PracticeEntry,
	Skill,
	SortField,
	Timestamp
} from './types.ts';

export interface PieceStats {
	timesPracticed: number;
	lastPracticed?: Timestamp;
}

export interface TagUsage {
	tag: string;
	count: number;
}

export interface LibraryIndex {
	readonly library: Library;
	/** Pieces that aren't deleted or merged away, in no particular order. */
	readonly live: Piece[];
	/** Tags on live pieces, most used first; casings of one tag are counted together. */
	readonly tags: TagUsage[];
	/** Distinct keys on live tunes and parts, sorted. */
	readonly keys: string[];
	get(id: PieceId): Piece | undefined;
	stats(piece: Piece): PieceStats;
	/** Practice history, most recent first. */
	effectivePractice(piece: Piece): PracticeEntry[];
	effectiveSkill(piece: Piece): Skill | undefined;
	effectiveKey(piece: Piece): string | undefined;
	/** The piece's tags, one spelling per tag, sorted. */
	tagsOf(piece: Piece): string[];
}

export function isLive(piece: Piece): boolean {
	return piece.deletedAt === undefined && piece.mergedInto === undefined;
}

/** Key and first notes only apply to tunes and parts. */
export function hasKey(piece: Pick<Piece, 'kind'>): boolean {
	return piece.kind === 'tune' || piece.kind === 'part';
}

export function buildIndex(library: Library): LibraryIndex {
	const live = Object.values(library.pieces).filter(isLive);
	const practiceCache = new Map<PieceId, PracticeEntry[]>();
	const statsCache = new Map<PieceId, PieceStats>();

	const tagCounts = new Map<string, TagUsage>();
	const keys = new Set<string>();
	for (const piece of live) {
		for (const tag of tagsOf(piece)) {
			const usage = tagCounts.get(tagKey(tag));
			if (usage) usage.count++;
			else tagCounts.set(tagKey(tag), { tag, count: 1 });
		}
		if (piece.key && hasKey(piece)) keys.add(piece.key);
	}

	const effectivePractice = (piece: Piece) => {
		let entries = practiceCache.get(piece.id);
		if (!entries) {
			entries = [...piece.practice].sort((a, b) => b.at - a.at);
			practiceCache.set(piece.id, entries);
		}
		return entries;
	};

	return {
		library,
		live,
		tags: [...tagCounts.values()].sort((a, b) => b.count - a.count || compareText(a.tag, b.tag)),
		keys: [...keys].sort(compareText),
		get: (id) => library.pieces[id],
		effectivePractice,
		stats(piece) {
			let stats = statsCache.get(piece.id);
			if (!stats) {
				const entries = effectivePractice(piece);
				stats = { timesPracticed: entries.length };
				if (entries.length > 0) stats.lastPracticed = entries[0].at;
				statsCache.set(piece.id, stats);
			}
			return stats;
		},
		effectiveSkill: (piece) => piece.skill,
		effectiveKey: (piece) => (hasKey(piece) ? piece.key : undefined),
		tagsOf
	};
}

function tagsOf(piece: Piece): string[] {
	const seen = new Map<string, string>();
	// Sorting first makes the kept spelling deterministic when casings collide after a merge.
	for (const tag of Object.keys(piece.tags).sort()) {
		if (!seen.has(tagKey(tag))) seen.set(tagKey(tag), tag);
	}
	return [...seen.values()].sort(compareText);
}

const memo = new WeakMap<Library, LibraryIndex>();

/**
 * The index for a doc snapshot, built once per snapshot. Automerge returns a new root object on
 * every change, so this is safe for docs; a plain object mutated in place needs buildIndex.
 */
export function getIndex(library: Library): LibraryIndex {
	let index = memo.get(library);
	if (!index) {
		index = buildIndex(library);
		memo.set(library, index);
	}
	return index;
}

// Search

/** Lowercase, no accents, no apostrophes or punctuation: "Cooley’s" → "cooleys". */
export function foldText(text: string): string {
	return text
		.normalize('NFD')
		.replace(/\p{M}/gu, '')
		.replace(/['’`]/g, '')
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.toLocaleLowerCase()
		.trim();
}

/** Every word of the query must appear in the title. Thesession aliases join in M3. */
export function matchesSearch(piece: Piece, query: string): boolean {
	const words = foldText(query).split(' ').filter(Boolean);
	if (words.length === 0) return true;
	const haystack = foldText(piece.title ?? '');
	return words.every((w) => haystack.includes(w));
}

// Filter

const DAY = 24 * 60 * 60 * 1000;

export function matchesFilter(
	index: LibraryIndex,
	piece: Piece,
	filter: ListSettings,
	now: Timestamp
): boolean {
	const kinds = Object.entries(filter.kinds).filter(([, on]) => on);
	if (kinds.length > 0 && !filter.kinds[piece.kind]) return false;

	if (filter.favoritesOnly && !piece.favorite) return false;

	const wanted = Object.keys(filter.tags ?? {}).map(tagKey);
	if (wanted.length > 0) {
		const has = new Set(Object.keys(piece.tags).map(tagKey));
		const ok =
			filter.tagMode === 'all' ? wanted.every((t) => has.has(t)) : wanted.some((t) => has.has(t));
		if (!ok) return false;
	}

	const skill = index.effectiveSkill(piece);
	if (filter.unratedOnly && skill !== undefined) return false;
	// Unrated counts as 1 (PLAN.md §14).
	const level = skill ?? 1;
	if (filter.skillMin !== undefined && level < filter.skillMin) return false;
	if (filter.skillMax !== undefined && level > filter.skillMax) return false;

	if (filter.key !== undefined && index.effectiveKey(piece) !== filter.key) return false;

	if (filter.practiced) {
		const last = index.stats(piece).lastPracticed;
		const recent = last !== undefined && now - last <= filter.practiced.days * DAY;
		if (recent !== filter.practiced.within) return false;
	}

	return true;
}

/** How many optional filters are set (kind not included), for a "Filters (n)" badge. */
export function activeFilterCount(filter: ListSettings): number {
	let n = 0;
	if (filter.favoritesOnly) n++;
	if (Object.keys(filter.tags ?? {}).length > 0) n++;
	if (filter.skillMin !== undefined || filter.skillMax !== undefined || filter.unratedOnly) n++;
	if (filter.key !== undefined) n++;
	if (filter.practiced) n++;
	return n;
}

// Sort

export function compareText(a: string, b: string): number {
	return a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
}

/**
 * Sorts in place. Untitled pieces sort after titled ones either way. Never-practiced counts as
 * the oldest "last practiced", and unrated as the lowest skill. Ties fall back to title, then
 * creation time.
 */
export function sortPieces(
	index: LibraryIndex,
	pieces: Piece[],
	sort: SortField,
	descending: boolean
): Piece[] {
	const dir = descending ? -1 : 1;
	const byTitle = (a: Piece, b: Piece) => {
		if (!a.title || !b.title) return (a.title ? 0 : 1) - (b.title ? 0 : 1);
		return compareText(a.title, b.title);
	};
	const value = (p: Piece): number => {
		switch (sort) {
			case 'created':
				return p.createdAt;
			case 'modified':
				return p.modifiedAt;
			case 'lastPracticed':
				return index.stats(p).lastPracticed ?? -Infinity;
			case 'timesPracticed':
				return index.stats(p).timesPracticed;
			case 'skill':
				return index.effectiveSkill(p) ?? 0;
			default:
				return 0;
		}
	};
	return pieces.sort((a, b) => {
		if (sort === 'title') {
			const missing = (a.title ? 0 : 1) - (b.title ? 0 : 1);
			if (missing !== 0) return missing;
			return dir * byTitle(a, b) || a.createdAt - b.createdAt;
		}
		const va = value(a);
		const vb = value(b);
		const primary = va === vb ? 0 : va < vb ? -dir : dir;
		return primary || byTitle(a, b) || a.createdAt - b.createdAt;
	});
}

export interface ListQuery {
	settings: ListSettings;
	query?: string;
	now?: Timestamp;
}

/** The main list: live pieces matching the search and filters, sorted. */
export function listPieces(index: LibraryIndex, { settings, query = '', now }: ListQuery): Piece[] {
	const at = now ?? Date.now();
	const pieces = index.live.filter(
		(p) => matchesSearch(p, query) && matchesFilter(index, p, settings, at)
	);
	return sortPieces(index, pieces, settings.sort, settings.descending);
}
