// Shuffle (flashcards, PLAN.md §6.5): which pieces are candidates, and how the next one is picked.
//
// Each candidate gets three features in [0, 1]: staleness A (from the *effective* practice
// history, so practising a Set counts for its tunes), weakness S (effective skill, unrated = 1)
// and affinity F (favorite and how often it's been practised). Each is divided by its temperature
// and the sum is sampled by softmax. A `null` temperature is ∞: the factor drops out. With every
// temperature at ∞ the pick is uniform. Pure, with an injectable RNG, so it's unit-testable.

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

/** A uniform random number in [0, 1), like Math.random. */
export type Rng = () => number;

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

export function toCandidate(index: LibraryIndex, piece: Piece): Candidate {
	const stats = index.stats(piece);
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
	/** Probability of being picked next; sums to 1 over the candidates. */
	p: number;
}

/**
 * Every candidate's features, logit and pick probability, for debugging and tests. The softmax
 * subtracts the largest logit first (log-sum-exp), so huge logits from tiny temperatures neither
 * overflow nor underflow to 0/0.
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

/** Samples the next piece. Undefined when there are no candidates left. */
export function pickNext(
	candidates: readonly Candidate[],
	settings: Pick<ShuffleSettings, 'tAge' | 'tSkill' | 'tFav'>,
	rng: Rng,
	now: Timestamp,
	options?: FeatureOptions
): Candidate | undefined {
	const rows = weights(candidates, settings, now, options);
	if (rows.length === 0) return undefined;
	let u = rng();
	for (const r of rows) {
		u -= r.p;
		if (u < 0) return r.candidate;
	}
	// Rounding can leave u a hair above 0 after the last row.
	return rows[rows.length - 1].candidate;
}

export interface CandidateQuery {
	/** Pieces already shown this session. */
	shown?: ReadonlySet<PieceId>;
	/** The main list's filter, applied when `settings.respectListFilter` is on. */
	list?: ListSettings;
	now: Timestamp;
}

/** Whether a piece passes the shuffle settings (kind and skill range, and the list filter). */
export function matchesShuffle(
	index: LibraryIndex,
	piece: Piece,
	settings: ShuffleSettings,
	{ list, now }: Pick<CandidateQuery, 'list' | 'now'>
): boolean {
	if (!settings.kinds[piece.kind]) return false;
	const skill = shuffleSkill(index.effectiveSkill(piece));
	if (skill < settings.skillMin || skill > settings.skillMax) return false;
	if (settings.respectListFilter && list && !matchesFilter(index, piece, list, now)) return false;
	return true;
}

/** Live pieces that pass the settings and haven't been shown yet, in no particular order. */
export function shuffleCandidates(
	index: LibraryIndex,
	settings: ShuffleSettings,
	query: CandidateQuery
): Candidate[] {
	const out: Candidate[] = [];
	for (const piece of index.live) {
		if (query.shown?.has(piece.id)) continue;
		if (matchesShuffle(index, piece, settings, query)) out.push(toCandidate(index, piece));
	}
	return out;
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

/** A small seeded RNG (mulberry32), for tests and reproducible sessions. */
export function seededRng(seed: number): Rng {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
