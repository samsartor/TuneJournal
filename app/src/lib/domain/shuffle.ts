// Shuffle (flashcards, PLAN.md §6.5): which pieces are candidates, and in what order they come up.
//
// Each candidate gets three features in [0, 1]: staleness A (from the *effective* practice
// history, so practising a Set counts for its tunes), weakness S (effective skill, unrated = 1)
// and affinity F (favorite and how often it's been practised). Each is divided by its temperature
// and summed into a logit. A `null` temperature is ∞: the factor drops out.
//
// The order is softmax sampling without replacement, done all at once with the Gumbel-top-k trick:
// each piece's key is its logit plus Gumbel noise -log(-log(u)), and sorting by key, descending,
// gives exactly the distribution of picking one piece at a time by softmax and removing it. Each
// piece's `u` is a hash of (seed, piece id), so a session is reproducible from its seed and start
// time alone (both live in the URL), and adding or removing a piece leaves everyone else's
// relative order alone. With every temperature at ∞ the order is a uniform shuffle.

import { matchesFilter, type LibraryIndex } from './derived.ts';
import type {
	ListSettings,
	Piece,
	PieceId,
	PieceKind,
	Settings,
	Skill,
	Temperature,
	Timestamp
} from './types.ts';

export type ShuffleSettings = Settings['shuffle'];

const DAY = 24 * 60 * 60 * 1000;

/** Days without practice after which a piece counts as fully stale (A = 1). */
export const HORIZON_DAYS = 60;
/** Times practised at which the "practised a lot" half of F saturates. */
export const CAP_COUNT = 20;

/** The lowest temperature a slider reaches; below this a factor is already all-or-nothing. */
export const T_MIN = 0.05;
/** The highest finite temperature, one notch below ∞. */
export const T_MAX = 10;
/** Slider positions 0…SLIDER_STEPS; the last one is ∞. */
export const SLIDER_STEPS = 20;

/** What the sampler needs to know about a piece (taken from the index, so it's effective). */
export interface Candidate {
	piece: Piece;
	/** Effective: includes practice on ancestor sets and sessions. */
	lastPracticed?: Timestamp;
	timesPracticed: number;
	/** Effective: a Part without its own uses its Tune's. Absent = unrated. */
	skill?: Skill;
	favorite: boolean;
}

export interface Features {
	/** Staleness. */
	age: number;
	/** Weakness. */
	skill: number;
	/** Affinity. */
	fav: number;
}

export interface FeatureOptions {
	horizonDays?: number;
	capCount?: number;
}

/** With `asOf`, practice logged after it is left out (the session's start, §6.5). */
export function toCandidate(index: LibraryIndex, piece: Piece, asOf?: Timestamp): Candidate {
	const stats = index.stats(piece, asOf);
	const candidate: Candidate = {
		piece,
		timesPracticed: stats.timesPracticed,
		favorite: piece.favorite
	};
	if (stats.lastPracticed !== undefined) candidate.lastPracticed = stats.lastPracticed;
	const skill = index.effectiveSkill(piece);
	if (skill !== undefined) candidate.skill = skill;
	return candidate;
}

/** Unrated counts as skill 1, for both the weakness factor and the skill-range filter (§14). */
export function shuffleSkill(skill: Skill | undefined): Skill {
	return skill ?? 1;
}

export function features(
	c: Candidate,
	now: Timestamp,
	{ horizonDays = HORIZON_DAYS, capCount = CAP_COUNT }: FeatureOptions = {}
): Features {
	const age =
		c.lastPracticed === undefined
			? 1
			: Math.min(Math.max(0, now - c.lastPracticed) / DAY / horizonDays, 1);
	const skill = (5 - shuffleSkill(c.skill)) / 4;
	const often = Math.min(Math.log1p(c.timesPracticed) / Math.log1p(capCount), 1);
	const fav = 0.5 * (c.favorite ? 1 : 0) + 0.5 * often;
	return { age, skill, fav };
}

/** A temperature's contribution: x / T, or nothing at all for T = ∞ (`null`). */
function term(x: number, t: Temperature): number {
	if (t === null || t === Infinity || x === 0) return 0;
	return x / Math.max(t, Number.MIN_VALUE);
}

export function logit(f: Features, settings: Pick<ShuffleSettings, 'tAge' | 'tSkill' | 'tFav'>) {
	return term(f.age, settings.tAge) + term(f.skill, settings.tSkill) + term(f.fav, settings.tFav);
}

export interface Weighted {
	candidate: Candidate;
	features: Features;
	logit: number;
	/** Probability of coming up first; sums to 1 over the candidates. */
	p: number;
}

/**
 * Every candidate's features, logit and probability of coming up first (the softmax that
 * `shuffleOrder` samples from), for debugging and tests. The softmax subtracts the largest logit
 * first (log-sum-exp), so huge logits from tiny temperatures neither overflow nor underflow to 0/0.
 */
export function weights(
	candidates: readonly Candidate[],
	settings: Pick<ShuffleSettings, 'tAge' | 'tSkill' | 'tFav'>,
	now: Timestamp,
	options?: FeatureOptions
): Weighted[] {
	const rows = candidates.map((candidate) => {
		const f = features(candidate, now, options);
		return { candidate, features: f, logit: logit(f, settings), p: 0 };
	});
	if (rows.length === 0) return rows;
	const max = Math.max(...rows.map((r) => r.logit));
	let sum = 0;
	for (const r of rows) {
		// A temperature of (nearly) 0 can make logits infinite: those pieces share the pick.
		r.p = max === Infinity ? (r.logit === Infinity ? 1 : 0) : Math.exp(r.logit - max);
		sum += r.p;
	}
	for (const r of rows) r.p /= sum;
	return rows;
}

// Ordering: Gumbel-top-k over per-piece hashed uniforms.

/**
 * cyrb53 (public domain, bryc): a small, well-mixed 53-bit string hash. Returns an integer in
 * [0, 2^53).
 */
export function hash53(str: string, seed = 0): number {
	let h1 = 0xdeadbeef ^ seed;
	let h2 = 0x41c6ce57 ^ seed;
	for (let i = 0; i < str.length; i++) {
		const ch = str.charCodeAt(i);
		h1 = Math.imul(h1 ^ ch, 2654435761);
		h2 = Math.imul(h2 ^ ch, 1597334677);
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
	h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
	h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

const TWO_52 = 2 ** 52;

/**
 * A uniform number in the open interval (0, 1), fixed for a (seed, piece) pair. Uses the top 52
 * bits of the hash, centred in their bucket: the smallest is 2^-53 and the largest 1 - 2^-53, both
 * exact in a double, so never 0 or 1.
 */
export function pieceUniform(seed: string, id: string): number {
	const h = Math.floor(hash53(`${seed}\u0000${id}`) / 2);
	return (h + 0.5) / TWO_52;
}

/** Standard Gumbel noise from a uniform in (0, 1): finite, roughly -3.6 to 36.7 here. */
export function gumbel(u: number): number {
	return -Math.log(-Math.log(u));
}

export interface Ranked {
	candidate: Candidate;
	logit: number;
	gumbel: number;
}

/**
 * Larger key first, where key = logit + gumbel. Compared as a difference of logits plus a
 * difference of noise, so two huge logits (from tiny temperatures) that are close still compare
 * by their noise instead of rounding it away. Infinite logits (a temperature of 0) beat finite
 * ones and tie among themselves, which then fall to the noise: an equal share, as in `weights`.
 * Last of all the piece id, so the order is total and deterministic.
 */
function compareRanked(a: Ranked, b: Ranked): number {
	if (a.logit !== b.logit) {
		if (a.logit === Infinity) return -1;
		if (b.logit === Infinity) return 1;
		const d = a.logit - b.logit + (a.gumbel - b.gumbel);
		if (d !== 0) return d > 0 ? -1 : 1;
	}
	if (a.gumbel !== b.gumbel) return a.gumbel > b.gumbel ? -1 : 1;
	const ia = a.candidate.piece.id;
	const ib = b.candidate.piece.id;
	return ia < ib ? -1 : ia > ib ? 1 : 0;
}

/**
 * The session's order: every candidate, ranked by logit + Gumbel noise from `pieceUniform(seed,
 * id)`. The same as drawing one at a time by softmax without replacement. Features are taken as
 * of `at`, the session's start, so the order doesn't drift while you practise.
 */
export function shuffleOrder(
	candidates: readonly Candidate[],
	settings: Pick<ShuffleSettings, 'tAge' | 'tSkill' | 'tFav'>,
	seed: string,
	at: Timestamp,
	options?: FeatureOptions
): Ranked[] {
	return candidates
		.map((candidate) => ({
			candidate,
			logit: logit(features(candidate, at, options), settings),
			gumbel: gumbel(pieceUniform(seed, candidate.piece.id))
		}))
		.sort(compareRanked);
}

export interface CandidateQuery {
	/** The main list's filter, applied when `settings.respectListFilter` is on. */
	list?: ListSettings;
	/**
	 * The session's start: features and the list's "practiced within" filter look at practice
	 * logged up to then, so practising mid-session doesn't change the order.
	 */
	at: Timestamp;
}

/** Whether a piece passes the shuffle settings (kind and skill range, and the list filter). */
export function matchesShuffle(
	index: LibraryIndex,
	piece: Piece,
	settings: ShuffleSettings,
	{ list, at }: CandidateQuery
): boolean {
	if (!settings.kinds[piece.kind]) return false;
	const skill = shuffleSkill(index.effectiveSkill(piece));
	if (skill < settings.skillMin || skill > settings.skillMax) return false;
	if (settings.respectListFilter && list && !matchesFilter(index, piece, list, at, at)) {
		return false;
	}
	return true;
}

/** Live pieces that pass the settings, as of `query.at`, in no particular order. */
export function shuffleCandidates(
	index: LibraryIndex,
	settings: ShuffleSettings,
	query: CandidateQuery
): Candidate[] {
	const out: Candidate[] = [];
	for (const piece of index.live) {
		if (matchesShuffle(index, piece, settings, query)) {
			out.push(toCandidate(index, piece, query.at));
		}
	}
	return out;
}

/** A session's ids in order: the candidates as of `at`, ranked with `seed`. */
export function sessionOrder(
	index: LibraryIndex,
	settings: ShuffleSettings,
	{ seed, at, list }: { seed: string; at: Timestamp; list?: ListSettings }
): PieceId[] {
	const candidates = shuffleCandidates(index, settings, { list, at });
	return shuffleOrder(candidates, settings, seed, at).map((r) => r.candidate.piece.id);
}

/**
 * What a session's order depends on besides seed, time and library: the temperatures, kinds,
 * skill range and, when it's respected, the list's filter (not its sort). A change starts a new
 * shuffle.
 */
export function shuffleFingerprint(settings: ShuffleSettings, list?: ListSettings): string {
	const { tAge, tSkill, tFav, kinds, skillMin, skillMax, respectListFilter } = settings;
	const filter =
		respectListFilter && list ? { ...list, sort: undefined, descending: undefined } : null;
	return JSON.stringify([
		tAge,
		tSkill,
		tFav,
		kinds,
		skillMin,
		skillMax,
		!!respectListFilter,
		filter
	]);
}

// The session in the URL: /shuffle?seed=…&at=…&i=… (§6.5).

export interface ShuffleSession {
	/** A short random string; with `at`, it fixes the order. */
	seed: string;
	/** The session's start, epoch ms. */
	at: Timestamp;
	/** 0-based position in the order of the card that's up. */
	i: number;
}

const SEED_RE = /^[0-9a-z]{1,32}$/;

/** A new session's seed: 8 base-36 characters (about 41 bits). */
export function newSeed(random: () => number = Math.random): string {
	let out = '';
	for (let k = 0; k < 8; k++) out += Math.floor(random() * 36).toString(36);
	return out;
}

/** The session in a URL's query, or undefined when the seed or time is missing or malformed. */
export function parseSession(params: Pick<URLSearchParams, 'get'>): ShuffleSession | undefined {
	const seed = params.get('seed');
	const atText = params.get('at');
	if (!seed || !SEED_RE.test(seed) || !atText || !/^\d{1,16}$/.test(atText)) return undefined;
	const iText = params.get('i');
	const i = iText && /^\d{1,9}$/.test(iText) ? Number(iText) : 0;
	return { seed, at: Number(atText), i };
}

export function sessionQuery({ seed, at, i }: ShuffleSession): string {
	return `seed=${seed}&at=${at}&i=${i}`;
}

/** Kinds turned on in the settings. */
export function shuffleKinds(settings: ShuffleSettings): PieceKind[] {
	return (Object.keys(settings.kinds) as PieceKind[]).filter((k) => settings.kinds[k]);
}

// Temperature sliders: positions 0…SLIDER_STEPS on a log scale from T_MIN to T_MAX, with the top
// notch meaning ∞.

export function temperatureAt(position: number): Temperature {
	const s = Math.round(Math.min(Math.max(position, 0), SLIDER_STEPS));
	if (s >= SLIDER_STEPS) return null;
	const t = T_MIN * Math.pow(T_MAX / T_MIN, s / (SLIDER_STEPS - 1));
	// Two significant digits are plenty, and keep the stored number tidy.
	return Number(t.toPrecision(2));
}

export function sliderPosition(t: Temperature): number {
	if (t === null || !Number.isFinite(t)) return SLIDER_STEPS;
	if (t <= T_MIN) return 0;
	if (t >= T_MAX) return SLIDER_STEPS - 1;
	return Math.round(((SLIDER_STEPS - 1) * Math.log(t / T_MIN)) / Math.log(T_MAX / T_MIN));
}

/** How strongly a temperature weighs its factor, in words, for the slider's value text. */
export function temperatureLabel(t: Temperature): string {
	if (t === null || !Number.isFinite(t)) return 'Off';
	if (t <= 0.15) return 'Very strong';
	if (t <= 0.5) return 'Strong';
	if (t <= 1.5) return 'Medium';
	if (t <= 4) return 'Mild';
	return 'Faint';
}
