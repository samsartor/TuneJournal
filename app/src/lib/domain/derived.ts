// Values derived from the Library, never stored (PLAN.md §5), plus list filter/sort/search.
//
// Practice and skill go through effectivePractice/effectiveSkill. In M1 they return the piece's
// own values; M5 adds the ancestor walk (practice) and Part → Tune inheritance (skill, key)
// there without touching the callers.

import { tagKey } from './ops.ts';
import { resolvePiece, sortLinks } from './relations.ts';
import type {
	Library,
	Link,
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
	/** The piece an id refers to now, following merge redirects. */
	resolve(id: PieceId): Piece | undefined;
	/** Live children, in order, each with its link. Links to merged pieces follow the redirect. */
	children(piece: Piece): Related[];
	/** Live parents, by title. */
	parents(piece: Piece): Related[];
	/** Live pieces linked to a thesession tune, oldest first. */
	withTune(tuneId: number): Piece[];
	/** Groups of two or more live pieces that share a thesession tune id, oldest group first. */
	readonly duplicateTunes: DuplicateGroup[];
}

export interface Related {
	piece: Piece;
	link: Link;
}

export interface DuplicateGroup {
	tuneId: number;
	/** Oldest first. */
	pieces: Piece[];
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
	const byTune = new Map<number, Piece[]>();
	for (const piece of live) {
		const tuneId = piece.external?.thesession?.tuneId;
		if (tuneId !== undefined) {
			const group = byTune.get(tuneId);
			if (group) group.push(piece);
			else byTune.set(tuneId, [piece]);
		}
		for (const tag of tagsOf(piece)) {
			const usage = tagCounts.get(tagKey(tag));
			if (usage) usage.count++;
			else tagCounts.set(tagKey(tag), { tag, count: 1 });
		}
		if (piece.key && hasKey(piece)) keys.add(piece.key);
	}

	const byAge = (a: Piece, b: Piece) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1);
	for (const group of byTune.values()) group.sort(byAge);
	const duplicateTunes = [...byTune]
		.filter(([, pieces]) => pieces.length > 1)
		.map(([tuneId, pieces]) => ({ tuneId, pieces }))
		.sort((a, b) => byAge(a.pieces[0], b.pieces[0]));

	const effectivePractice = (piece: Piece) => {
		let entries = practiceCache.get(piece.id);
		if (!entries) {
			entries = dedupePractice(piece.practice).sort((a, b) => b.at - a.at);
			practiceCache.set(piece.id, entries);
		}
		return entries;
	};

	// Links grouped by (resolved) end, built on first use.
	let linksBy: { children: Map<PieceId, Related[]>; parents: Map<PieceId, Related[]> } | undefined;
	const relations = () => {
		if (linksBy) return linksBy;
		const children = new Map<PieceId, Related[]>();
		const parents = new Map<PieceId, Related[]>();
		const seen = new Set<string>();
		for (const link of sortLinks(Object.values(library.links))) {
			const parent = resolvePiece(library, link.parent);
			const child = resolvePiece(library, link.child);
			if (!parent || !child || !isLive(parent) || !isLive(child) || parent === child) continue;
			const pair = `${parent.id}:${child.id}`;
			if (seen.has(pair)) continue;
			seen.add(pair);
			push(children, parent.id, { piece: child, link });
			push(parents, child.id, { piece: parent, link });
		}
		for (const list of parents.values()) {
			list.sort((a, b) => compareText(a.piece.title ?? '', b.piece.title ?? ''));
		}
		linksBy = { children, parents };
		return linksBy;
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
		tagsOf,
		resolve: (id) => resolvePiece(library, id),
		children: (piece) => relations().children.get(piece.id) ?? [],
		parents: (piece) => relations().parents.get(piece.id) ?? [],
		withTune: (tuneId) => byTune.get(tuneId) ?? [],
		duplicateTunes
	};
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
	const list = map.get(key);
	if (list) list.push(value);
	else map.set(key, [value]);
}

/**
 * Drops repeated entries (same time, via and skill). Two devices merging the same pieces at once
 * both copy the loser's log into the survivor, so the doc can hold doubles.
 */
function dedupePractice(entries: readonly PracticeEntry[]): PracticeEntry[] {
	const seen = new Set<string>();
	return entries.filter((e) => {
		const key = `${e.at}|${e.via ?? ''}|${e.skillAfter ?? ''}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
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

/**
 * Every word of the query must appear in the title, or all of them in one of the piece's other
 * names (its thesession aliases, passed in by the caller since they live in the integration cache).
 */
export function matchesSearch(
	piece: Piece,
	query: string,
	aliases: readonly string[] = []
): boolean {
	const words = foldText(query).split(' ').filter(Boolean);
	if (words.length === 0) return true;
	return [piece.title ?? '', ...aliases].some((name) => {
		const haystack = foldText(name);
		return words.every((w) => haystack.includes(w));
	});
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
	/** Other names to search by, per piece (thesession aliases from the cache). */
	aliases?: ReadonlyMap<PieceId, readonly string[]>;
}

/** The main list: live pieces matching the search and filters, sorted. */
export function listPieces(
	index: LibraryIndex,
	{ settings, query = '', now, aliases }: ListQuery
): Piece[] {
	const at = now ?? Date.now();
	const pieces = index.live.filter(
		(p) => matchesSearch(p, query, aliases?.get(p.id)) && matchesFilter(index, p, settings, at)
	);
	return sortPieces(index, pieces, settings.sort, settings.descending);
}
