// Values derived from the Library, never stored (PLAN.md §5), plus list filter/sort/search.
//
// Practice, skill, key and first notes go through effectivePractice/effectiveSkill/effectiveKey/
// effectiveFirstNotes (PLAN.md §5): practice combines the piece's own entries with every ancestor's
// (walking parent links with a visited set, since links may form cycles); a Part without its own
// skill uses its earliest-created parent Tune's; and a piece without its own key or first notes
// uses its first recording that has them (a linked thesession setting's, say), then, for a Part's
// key only, its Tune's effective key.

import { tagKey } from './ops.ts';
import { PROVIDERS } from './providers.ts';
import { sortedClips } from './recordings.ts';
import { resolvePiece, sortLinks } from './relations.ts';
import type {
	Clip,
	Library,
	Link,
	ListSettings,
	Piece,
	PieceId,
	PracticeEntry,
	Skill,
	Provider,
	SortField,
	Source,
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
	/** Distinct effective keys of live tunes and parts, sorted. */
	readonly keys: string[];
	get(id: PieceId): Piece | undefined;
	stats(piece: Piece): PieceStats;
	/**
	 * Practice history, most recent first: the piece's own entries plus those of every ancestor,
	 * each inherited one marked with the ancestor it came from (`viaPiece`).
	 */
	effectivePractice(piece: Piece): EffectivePracticeEntry[];
	/** Own skill, else (Parts only) the inherited Tune's. */
	effectiveSkill(piece: Piece): Skill | undefined;
	/**
	 * Own key, else the first recording's (in order) that has one, else (Parts only) the inherited
	 * Tune's effective key. Undefined for sets and sessions.
	 */
	effectiveKey(piece: Piece): string | undefined;
	/** effectiveKey with where it came from. */
	keyOf(piece: Piece): Effective | undefined;
	/** What the key would be without the piece's own: what clearing it goes back to. */
	inheritedKey(piece: Piece): Effective | undefined;
	/**
	 * Own first notes, else the first recording's (in order) that has some. Parts don't inherit
	 * their Tune's (a B part starts differently). Undefined for sets and sessions.
	 */
	effectiveFirstNotes(piece: Piece): string | undefined;
	/** effectiveFirstNotes with where it came from. */
	firstNotesOf(piece: Piece): Effective | undefined;
	/** What the first notes would be without the piece's own. */
	inheritedFirstNotes(piece: Piece): Effective | undefined;
	/** The Tune a Part inherits skill and key from: its earliest-created live parent Tune. */
	inheritsFrom(piece: Piece): Piece | undefined;
	/** Live ancestors (parents, their parents, …), nearest first, without the piece itself. */
	ancestors(piece: Piece): Piece[];
	/** The piece's clips in order, each with its source (clips whose source is missing are left out). */
	clipsOf(piece: Piece): ClipWithSource[];
	/** Has a clip of an actual recording, not just a reference link such as thesession.org. */
	hasRecordings(piece: Piece): boolean;
	/** Distinct providers of the piece's clips, in clip order, for card icons. */
	providersOf(piece: Piece): Provider[];
	/** Key as played in a clip: its own override, else the piece's effective key (§5). */
	clipKey(piece: Piece, clip: Clip): string | undefined;
	/** First notes as played in a clip: its own override, else the piece's effective ones. */
	clipFirstNotes(piece: Piece, clip: Clip): string | undefined;
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

/** Where an effective key or first notes came from (PLAN.md §5). */
export type ValueOrigin =
	| { from: 'own' }
	/** The piece's first recording, in order, that has a value. */
	| { from: 'clip'; clip: Clip; source: Source }
	/** A Part's Tune (whose own value may in turn come from one of its recordings). */
	| { from: 'tune'; tune: Piece };

export interface Effective {
	value: string;
	origin: ValueOrigin;
}

export interface EffectivePracticeEntry extends PracticeEntry {
	/** Set on entries inherited from an ancestor (a Set this tune is in, …): that ancestor's id. */
	viaPiece?: PieceId;
}

export interface ClipWithSource {
	clip: Clip;
	source: Source;
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

/** A recording to listen to, as opposed to a reference link (thesession, FolkFriend). */
export function isRecording(source: Pick<Source, 'provider'>): boolean {
	return PROVIDERS[source.provider]?.recording ?? false;
}

/** Key and first notes only apply to tunes and parts. */
export function hasKey(piece: Pick<Piece, 'kind'>): boolean {
	return piece.kind === 'tune' || piece.kind === 'part';
}

export function buildIndex(library: Library): LibraryIndex {
	const live = Object.values(library.pieces).filter(isLive);
	const practiceCache = new Map<PieceId, EffectivePracticeEntry[]>();
	const statsCache = new Map<PieceId, PieceStats>();

	const tagCounts = new Map<string, TagUsage>();
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
	}

	const byAge = (a: Piece, b: Piece) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1);
	for (const group of byTune.values()) group.sort(byAge);
	const duplicateTunes = [...byTune]
		.filter(([, pieces]) => pieces.length > 1)
		.map(([tuneId, pieces]) => ({ tuneId, pieces }))
		.sort((a, b) => byAge(a.pieces[0], b.pieces[0]));

	const clipsCache = new Map<PieceId, ClipWithSource[]>();
	const clipsOf = (piece: Piece) => {
		let clips = clipsCache.get(piece.id);
		if (!clips) {
			clips = [];
			for (const clip of sortedClips(piece)) {
				const source = library.sources[clip.sourceId];
				if (source) clips.push({ clip, source });
			}
			clipsCache.set(piece.id, clips);
		}
		return clips;
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

	const ancestorsCache = new Map<PieceId, Piece[]>();
	/** Breadth-first up the parent links, so nearer ancestors come first; cycle-safe. */
	const ancestors = (piece: Piece): Piece[] => {
		let found = ancestorsCache.get(piece.id);
		if (found) return found;
		found = [];
		const { parents } = relations();
		const seen = new Set<PieceId>([piece.id]);
		let frontier = [piece.id];
		while (frontier.length > 0) {
			const next: PieceId[] = [];
			for (const id of frontier) {
				for (const { piece: parent } of parents.get(id) ?? []) {
					if (seen.has(parent.id)) continue;
					seen.add(parent.id);
					found.push(parent);
					next.push(parent.id);
				}
			}
			frontier = next;
		}
		ancestorsCache.set(piece.id, found);
		return found;
	};

	const ownPractice = (piece: Piece) => dedupePractice(piece.practice);

	const effectivePractice = (piece: Piece) => {
		let entries = practiceCache.get(piece.id);
		if (!entries) {
			entries = ownPractice(piece);
			for (const ancestor of ancestors(piece)) {
				for (const entry of ownPractice(ancestor))
					entries.push({ ...entry, viaPiece: ancestor.id });
			}
			entries.sort((a, b) => b.at - a.at);
			practiceCache.set(piece.id, entries);
		}
		return entries;
	};

	const inheritCache = new Map<PieceId, Piece | null>();
	const inheritsFrom = (piece: Piece): Piece | undefined => {
		if (piece.kind !== 'part') return undefined;
		let tune = inheritCache.get(piece.id);
		if (tune === undefined) {
			tune = null;
			for (const { piece: parent } of relations().parents.get(piece.id) ?? []) {
				if (parent.kind === 'tune' && (!tune || byAge(parent, tune) < 0)) tune = parent;
			}
			inheritCache.set(piece.id, tune);
		}
		return tune ?? undefined;
	};
	const effectiveSkill = (piece: Piece) => piece.skill ?? inheritsFrom(piece)?.skill;

	/** The first clip, in order, with a value for `field`. */
	const fromClips = (piece: Piece, field: 'key' | 'firstNotes'): Effective | undefined => {
		for (const { clip, source } of clipsOf(piece)) {
			const value = clip[field];
			if (value) return { value, origin: { from: 'clip', clip, source } };
		}
		return undefined;
	};

	const memoized = (compute: (piece: Piece) => Effective | undefined) => {
		const cache = new Map<PieceId, Effective | null>();
		return (piece: Piece): Effective | undefined => {
			let found = cache.get(piece.id);
			if (found === undefined) {
				found = (hasKey(piece) && compute(piece)) || null;
				cache.set(piece.id, found);
			}
			return found ?? undefined;
		};
	};

	// Only Parts inherit, and only from a Tune, which never inherits itself: no cycles.
	const inheritedKey = memoized((piece) => {
		const own = fromClips(piece, 'key');
		if (own) return own;
		const tune = inheritsFrom(piece);
		const value = tune ? keyOf(tune)?.value : undefined;
		return tune && value ? { value, origin: { from: 'tune', tune } } : undefined;
	});
	const keyOf = memoized((piece) =>
		piece.key ? { value: piece.key, origin: { from: 'own' } } : inheritedKey(piece)
	);
	const effectiveKey = (piece: Piece) => keyOf(piece)?.value;

	const inheritedFirstNotes = memoized((piece) => fromClips(piece, 'firstNotes'));
	const firstNotesOf = memoized((piece) =>
		piece.firstNotes
			? { value: piece.firstNotes, origin: { from: 'own' } }
			: inheritedFirstNotes(piece)
	);
	const effectiveFirstNotes = (piece: Piece) => firstNotesOf(piece)?.value;

	let keys: string[] | undefined;

	return {
		library,
		live,
		tags: [...tagCounts.values()].sort((a, b) => b.count - a.count || compareText(a.tag, b.tag)),
		// Built on first use: it walks every Part's links.
		get keys() {
			if (!keys) {
				const found = new Set<string>();
				for (const piece of live) {
					const key = effectiveKey(piece);
					if (key) found.add(key);
				}
				keys = [...found].sort(compareText);
			}
			return keys;
		},
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
		effectiveSkill,
		effectiveKey,
		keyOf,
		inheritedKey,
		effectiveFirstNotes,
		firstNotesOf,
		inheritedFirstNotes,
		inheritsFrom,
		ancestors,
		clipsOf,
		hasRecordings: (piece) => clipsOf(piece).some(({ source }) => isRecording(source)),
		providersOf: (piece) => [...new Set(clipsOf(piece).map(({ source }) => source.provider))],
		clipKey: (piece, clip) => (hasKey(piece) ? (clip.key ?? effectiveKey(piece)) : undefined),
		clipFirstNotes: (piece, clip) =>
			hasKey(piece) ? (clip.firstNotes ?? effectiveFirstNotes(piece)) : undefined,
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

	if (filter.recordings && index.hasRecordings(piece) !== (filter.recordings === 'has')) {
		return false;
	}

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
	if (filter.recordings) n++;
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
