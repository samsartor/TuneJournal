// "Humanized" synthesized playback (PLAN.md §14 "Synth humanization"): the pure half. Folk tunes
// aren't played evenly as written. Notes on the strong quavers are a little longer (lilt), louder
// (accent) and sharper (attack) than the ones between. This module works on abcjs' flat note events
// (start and duration in whole notes, volume as MIDI velocity) and on the rendered samples; the
// browser half (audio/synth.ts) applies it. Which settings apply to a tune comes from its tag
// playback profile (domain/playback.ts).
//
// The grid is the quaver. Quavers are grouped in twos in simple meters (reels, hornpipes, polkas:
// 2/2, 4/4, 2/4, 3/4, 3/2) and in threes in compound ones (jigs, slip jigs, slides: 6/8, 9/8,
// 12/8). Counting from 1 in each bar, the strong positions are 1 mod 2 or 1 mod 3 (1, 3, 5, 7 in a
// reel; 1, 4 in a jig). Accent and attack always go on those; a negative amount de-emphasises them,
// which makes the quavers between relatively stronger (an old-time feel).

/** A meter as abcjs gives it (`getMeterFraction`). */
export interface Meter {
	num: number;
	den?: number;
}

/** The humanization settings. As written: lilt 1, accent 0, attack 0. */
export interface Humanize {
	/**
	 * The lilt as a long:short ratio: the strong quaver's length over each of the others in its
	 * group (2 = 2:1 pairs in a reel; in a jig, the first quaver against each of the other two).
	 * 1 is even; below 1 the strong quaver is the short one. From MIN_LILT to MAX_LILT.
	 */
	lilt: number;
	/** −100 to 100. The strong quavers louder, the others softer: 100 = 1.5× and 0.5× the velocity. */
	accent: number;
	/** −100 to 100. The strong notes' attack sharpened: 100 = 3× the level at the onset, easing to 1×. */
	attack: number;
}

export const HUMANIZE_OFF: Humanize = { lilt: 1, accent: 0, attack: 0 };

export const MIN_LILT = 0.5;
export const MAX_LILT = 2;

/**
 * The lilt slider's notches, roughly evenly spaced on a log scale and symmetric about Even (each
 * ratio below 1 is the reciprocal of one above), so the slider has its middle at 1.
 */
const LILT_UP = [1.05, 1.1, 1.15, 1.2, 1.25, 1.33, 1.4, 1.5, 1.6, 1.75, 2];
export const LILT_NOTCHES: readonly number[] = [
	...LILT_UP.map((r) => roundLilt(1 / r)).reverse(),
	1,
	...LILT_UP
];

function roundLilt(r: number): number {
	return Math.round(r * 1000) / 1000;
}

/** The notch nearest a ratio (on the log scale): the slider's position for a stored value. */
export function liltNotch(ratio: number): number {
	let best = 0;
	for (let i = 1; i < LILT_NOTCHES.length; i++) {
		const d = Math.abs(Math.log(LILT_NOTCHES[i] / ratio));
		if (d < Math.abs(Math.log(LILT_NOTCHES[best] / ratio))) best = i;
	}
	return best;
}

/** Accent at 100: strong notes ×1.5 velocity. */
const MAX_ACCENT = 0.5;
/** Attack at 100: ×3 at the onset; at −100, a fade in from silence. */
const MAX_ATTACK_BOOST = 2;
/** How long the attack shaping lasts after each strong onset. */
export const ATTACK_SECONDS = 0.05;

/** Times closer than this (in whole notes) are the same: abcjs rounds starts to 1e-6. */
const EPS = 1e-4;

const clampAmount = (v: unknown, fallback: number) => {
	const n = Math.round(Number(v));
	return Number.isFinite(n) ? Math.max(-100, Math.min(100, n)) : fallback;
};

/** A stored lilt ratio, clamped to MIN_LILT–MAX_LILT and rounded to 0.001. */
export function clampLilt(v: unknown, fallback = 1): number {
	const n = Number(v);
	if (!Number.isFinite(n) || n <= 0) return fallback;
	return roundLilt(Math.max(MIN_LILT, Math.min(MAX_LILT, n)));
}

/** Fills gaps and drops nonsense in stored settings. */
export function normalizeHumanize(value: unknown, defaults = HUMANIZE_OFF): Humanize {
	const v = (value && typeof value === 'object' ? value : {}) as Partial<Humanize>;
	return {
		lilt: v.lilt === undefined ? defaults.lilt : clampLilt(v.lilt, defaults.lilt),
		accent: v.accent === undefined ? defaults.accent : clampAmount(v.accent, defaults.accent),
		attack: v.attack === undefined ? defaults.attack : clampAmount(v.attack, defaults.attack)
	};
}

/** Whether these settings change nothing (the rendering is exactly the plain one). */
export function isHumanizeOff(h: Humanize): boolean {
	return h.lilt === 1 && h.accent === 0 && h.attack === 0;
}

/**
 * The audio cache key part for these settings: none when off, so plain renderings keep the keys
 * they had before humanization existed. `hr` (the lilt as a ratio) sets these apart from the
 * keys of the first version (`h20,20,15`, a −100–100 lilt and no grace-note handling).
 */
export function humanizeKey(h: Humanize): string | undefined {
	if (isHumanizeOff(h)) return undefined;
	return `hr${roundLilt(h.lilt)},${h.accent},${h.attack}`;
}

const trimNumber = (n: number) => String(Number(n.toFixed(2)));

/** The lilt for people: "Even", "1.5:1", or "1:1.5" below 1. */
export function formatLilt(ratio: number): string {
	if (Math.abs(ratio - 1) < 1e-6) return 'Even';
	return ratio > 1 ? `${trimNumber(ratio)}:1` : `1:${trimNumber(1 / ratio)}`;
}

/** The beat grid of a meter, in whole notes, or undefined for meters we don't humanize. */
export interface Grid {
	/** The quaver. */
	unit: number;
	/** Quavers per group: 2 (simple meters) or 3 (compound). */
	group: number;
	/** A full bar. */
	measure: number;
}

export function meterGrid(meter: Meter | undefined): Grid | undefined {
	if (!meter) return undefined;
	const num = Number(meter.num);
	const den = Number(meter.den);
	if (!(Number.isInteger(num) && num > 0)) return undefined;
	const measure = num / den;
	// Simple meters in crotchets or minims: quaver pairs.
	if (den === 4 || den === 2) return { unit: 1 / 8, group: 2, measure };
	// Compound meters in quavers: groups of three.
	if (den === 8 && num % 3 === 0) return { unit: 1 / 8, group: 3, measure };
	return undefined;
}

/**
 * One group of quavers (or part of one, in a short bar). Its first position is at `origin`; it
 * covers `[from, to)`. A pickup's group can start before the music does (`from > origin`).
 */
export interface Group {
	origin: number;
	from: number;
	to: number;
}

const near = (a: number, b: number) => Math.abs(a - b) < EPS;

/**
 * Splits a tune into groups, from where its bar lines fall (`barStarts`: the start of every bar,
 * in whole notes, the first being 0) and its length. Full (and over-long) bars are counted from
 * their start. A short bar is a pickup, counted back from its end, when it starts a time through
 * (`copies` equal times through the tune) or completes the short bar before it (a pickup inside a
 * repeat, after the shortened last bar of the part); any other short bar is counted from its start.
 */
export function beatGroups(
	barStarts: readonly number[],
	total: number,
	grid: Grid,
	copies = 1
): Group[] {
	const span = grid.unit * grid.group;
	const copyLength = total / Math.max(1, copies);
	const starts = [...barStarts.filter((t) => t >= 0 && t < total - EPS)].sort((a, b) => a - b);
	if (starts.length === 0 || !near(starts[0], 0)) starts.unshift(0);
	const groups: Group[] = [];
	let carry = 0;
	for (let i = 0; i < starts.length; i++) {
		const s = starts[i];
		const e = i + 1 < starts.length ? starts[i + 1] : total;
		const length = e - s;
		if (length < EPS) continue;
		const short = length < grid.measure - EPS;
		const copyStart = near(s, Math.round(s / copyLength) * copyLength);
		const pickup = short && (copyStart || (carry > 0 && near(carry + length, grid.measure)));
		carry = short && !pickup ? length : 0;
		if (pickup) {
			const bar: Group[] = [];
			for (let origin = e - span; origin > s - span + EPS; origin -= span)
				bar.unshift({ origin, from: Math.max(origin, s), to: origin + span });
			groups.push(...bar);
		} else {
			for (let origin = s; origin < e - EPS; origin += span)
				groups.push({ origin, from: origin, to: Math.min(origin + span, e) });
		}
	}
	return groups;
}

/** The group a time falls in (binary search; groups are in order and don't overlap). */
function groupAt(groups: readonly Group[], t: number): Group | undefined {
	let lo = 0;
	let hi = groups.length - 1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		const g = groups[mid];
		if (t < g.from - EPS) hi = mid - 1;
		else if (t >= g.to - EPS) lo = mid + 1;
		else return g;
	}
	return undefined;
}

/**
 * The lilt as a time warp: within each group, the first quaver `[origin, origin + unit)` is
 * stretched or squeezed so it is `ratio` times as long as each of the others, and the rest of the
 * group fits around it, piecewise linearly, so group boundaries (and so bar lines) stay put and the
 * order of everything is kept. Any time maps, so triplets, grace notes and notes across groups
 * scale consistently. A short group (a shortened bar's) uses the same ratio against what's left of
 * it. A group missing its first quaver (a pickup's) or with nothing after it is left as it is.
 *
 * With `n` quavers' worth after the first (1 in a reel's pair, 2 in a jig's three), the first
 * becomes `L = ratio × (1 + n) / (ratio + n)` quavers and each of the others `L / ratio`.
 */
export function liltWarp(
	groups: readonly Group[],
	grid: Grid,
	ratio: number
): (t: number) => number {
	const r = clampLilt(ratio);
	if (r === 1) return (t) => t;
	return (t) => {
		const g = groupAt(groups, t);
		if (!g || g.from > g.origin + EPS) return t;
		const p = g.origin + grid.unit;
		const rest = g.to - p;
		if (rest < EPS) return t;
		const n = rest / grid.unit;
		const first = (grid.unit * r * (1 + n)) / (r + n);
		if (t <= p) return g.origin + ((t - g.origin) * first) / grid.unit;
		return g.origin + first + ((Math.min(t, g.to) - p) * (rest + grid.unit - first)) / rest;
	};
}

/** Where a note starts on the grid: the strong position, another quaver, or off the grid. */
export type Stress = 'strong' | 'weak' | 'off';

export function stressAt(groups: readonly Group[], grid: Grid, t: number) {
	const g = groupAt(groups, t);
	if (!g) return 'off' as Stress;
	const position = (t - g.origin) / grid.unit;
	const index = Math.round(position);
	if (!near(position, index)) return 'off' as Stress;
	return (index === 0 ? 'strong' : 'weak') as Stress;
}

/** The part of an abcjs note event humanization reads and changes. */
export interface NoteEvent {
	cmd: string;
	start?: number;
	duration?: number;
	volume?: number;
	style?: string;
}

export interface HumanizeInput {
	/** abcjs' tracks (`setUpAudio().tracks`), changed in place. */
	tracks: NoteEvent[][];
	meter: Meter | undefined;
	barStarts: readonly number[];
	/** The tune's length in whole notes (`totalDuration`). */
	total: number;
	/** Times through, each starting with the same pickup. */
	copies: number;
	settings: Humanize;
}

/**
 * Applies lilt and accent to abcjs' note events in place, and returns the strong notes' onsets
 * (after the lilt, in whole notes, sorted, without duplicates) for the attack. Changes nothing
 * when the settings are off or the meter isn't one we know.
 *
 * Grace notes: abcjs plays them *in* their main note's time. `{g}A2` becomes a grace at A's
 * written start, taking half of A's length, and A itself starts halfway through (style 'grace' on
 * the graces, written just before the main note in the same track). So the stress of a note right
 * after a run of graces comes from where the run starts, its written position: the main note gets
 * the strong (or weak) accent and the attack onset, and the graces keep abcjs' own velocity.
 * Everything still goes through the lilt warp at its actual time.
 */
export function humanizeNotes(input: HumanizeInput): number[] {
	const { settings } = input;
	const grid = meterGrid(input.meter);
	if (!grid || isHumanizeOff(settings)) return [];
	const groups = beatGroups(input.barStarts, input.total, grid, input.copies);
	const warp = liltWarp(groups, grid, settings.lilt);
	const lilted = clampLilt(settings.lilt) !== 1;
	const k = (Math.max(-100, Math.min(100, settings.accent)) / 100) * MAX_ACCENT;
	const strongGain = 1 + k;
	const weakGain = 1 - k / (grid.group - 1);
	const onsets = new Set<number>();
	for (const track of input.tracks) {
		/** The graces just played: where the first started and where the last ends. */
		let graces: { from: number; end: number } | undefined;
		for (const event of track) {
			if (event.cmd !== 'note' || event.start === undefined) continue;
			const start = event.start;
			let stress: Stress;
			if (event.style === 'grace') {
				const end = start + (event.duration ?? 0);
				if (graces && near(start, graces.end)) graces.end = end;
				else graces = { from: start, end };
				stress = 'off';
			} else {
				// The main note of the graces (each note of it, for a chord) starts where they end.
				const graced = graces && near(start, graces.end);
				if (!graced) graces = undefined;
				stress = stressAt(groups, grid, graced ? graces!.from : start);
			}
			if (lilted) {
				const end = start + (event.duration ?? 0);
				const s = warp(start);
				event.start = Math.round(s * 1e6) / 1e6;
				if (event.duration !== undefined) event.duration = Math.round((warp(end) - s) * 1e6) / 1e6;
			}
			if (k && event.volume !== undefined && stress !== 'off') {
				const v = event.volume * (stress === 'strong' ? strongGain : weakGain);
				event.volume = Math.max(1, Math.min(127, Math.round(v)));
			}
			if (stress === 'strong') onsets.add(event.start);
		}
	}
	return settings.attack ? [...onsets].sort((x, y) => x - y) : [];
}

/**
 * Shapes the attack of the strong notes in a rendered (mixed) buffer, in place: for
 * `ATTACK_SECONDS` after each onset (in seconds), the level is multiplied by a gain that starts at
 * `1 + boost` and eases back to 1. A positive `attack` makes the start of those notes punchier;
 * a negative one fades them in. Each onset's shaping ends at the next one. An approximation of a
 * faster or slower attack, since the samples' own can't change.
 */
export function shapeAttack(
	samples: Float32Array,
	sampleRate: number,
	onsets: readonly number[],
	attack: number
): void {
	const a = Math.max(-100, Math.min(100, attack)) / 100;
	if (a === 0 || onsets.length === 0) return;
	const boost = a > 0 ? a * MAX_ATTACK_BOOST : a;
	const window = Math.max(1, Math.round(ATTACK_SECONDS * sampleRate));
	for (let i = 0; i < onsets.length; i++) {
		const from = Math.max(0, Math.round(onsets[i] * sampleRate));
		const next = i + 1 < onsets.length ? Math.round(onsets[i + 1] * sampleRate) : Infinity;
		const to = Math.min(samples.length, from + window, next);
		for (let j = from; j < to; j++) {
			const x = (j - from) / window;
			samples[j] *= 1 + boost * (1 - x) * (1 - x);
		}
	}
}
