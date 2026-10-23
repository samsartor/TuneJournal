// "Humanized" synthesized playback (PLAN.md §14 "Synth humanization"): the pure half. Folk tunes
// aren't played evenly as written. Notes on the strong quavers are a little longer (lilt), louder
// (accent) and sharper (attack) than the ones between. This module works on abcjs' flat note events
// (start and duration in whole notes, volume as MIDI velocity) and on the rendered samples; the
// browser half (audio/synth.ts) applies it.
//
// The grid is the quaver. Quavers are grouped in twos in simple meters (reels, hornpipes, polkas:
// 2/2, 4/4, 2/4, 3/4, 3/2) and in threes in compound ones (jigs, slip jigs, slides: 6/8, 9/8,
// 12/8). Counting from 1 in each bar, the strong positions are 1 mod 2 or 1 mod 3 (1, 3, 5, 7 in a
// reel; 1, 4 in a jig). In the old-time style the accent goes on the last quaver of each group
// instead (0 mod 2 in a reel); the lilt is the same.

/** A meter as abcjs gives it (`getMeterFraction`). */
export interface Meter {
	num: number;
	den?: number;
}

export type HumanizeStyle = 'irish' | 'oldtime';

export const HUMANIZE_STYLES: Record<HumanizeStyle, string> = {
	irish: 'Irish',
	oldtime: 'Old-time'
};

/**
 * The humanization settings, each from −100 to 100 (0 = played as written). Negative values do
 * the reverse: the off-beats long, loud or sharp.
 */
export interface Humanize {
	style: HumanizeStyle;
	/** The strong quaver longer, the others in its group shorter: 100 = 2:1 in a reel. */
	lilt: number;
	/** The strong quavers louder, the others softer: 100 = 1.5× and 0.5× the velocity. */
	accent: number;
	/** The strong notes' attack sharpened: 100 = 3× the level at the onset, easing to 1×. */
	attack: number;
}

export const HUMANIZE_OFF: Humanize = { style: 'irish', lilt: 0, accent: 0, attack: 0 };

/** Gentle: a lilt of about 1.14:1 in a reel, accents about ±10%, a slightly sharper attack. */
export const HUMANIZE_DEFAULTS: Humanize = { style: 'irish', lilt: 20, accent: 20, attack: 15 };

/** Lilt at 100: the strong quaver gains a third of a quaver (2:1 in pairs, triplet swing). */
const MAX_LILT = 1 / 3;
/** Accent at 100: strong notes ×1.5 velocity. */
const MAX_ACCENT = 0.5;
/** Attack at 100: ×3 at the onset; at −100, a fade in from silence. */
const MAX_ATTACK_BOOST = 2;
/** How long the attack shaping lasts after each strong onset. */
export const ATTACK_SECONDS = 0.05;

/** Times closer than this (in whole notes) are the same: abcjs rounds starts to 1e-6. */
const EPS = 1e-4;

const clampSetting = (v: unknown, fallback: number) => {
	const n = Math.round(Number(v));
	return Number.isFinite(n) ? Math.max(-100, Math.min(100, n)) : fallback;
};

/** Fills gaps and drops nonsense in stored settings. */
export function normalizeHumanize(value: unknown, defaults = HUMANIZE_DEFAULTS): Humanize {
	const v = (value && typeof value === 'object' ? value : {}) as Partial<Humanize>;
	return {
		style: v.style === 'irish' || v.style === 'oldtime' ? v.style : defaults.style,
		lilt: v.lilt === undefined ? defaults.lilt : clampSetting(v.lilt, defaults.lilt),
		accent: v.accent === undefined ? defaults.accent : clampSetting(v.accent, defaults.accent),
		attack: v.attack === undefined ? defaults.attack : clampSetting(v.attack, defaults.attack)
	};
}

/** Whether these settings change nothing (the rendering is exactly the plain one). */
export function isHumanizeOff(h: Humanize): boolean {
	return h.lilt === 0 && h.accent === 0 && h.attack === 0;
}

/**
 * The audio cache key part for these settings: none when off, so plain renderings keep the keys
 * they had before humanization existed. The style only matters for accent and attack.
 */
export function humanizeKey(h: Humanize): string | undefined {
	if (isHumanizeOff(h)) return undefined;
	const style = h.style === 'oldtime' && (h.accent || h.attack) ? 'o' : '';
	return `h${h.lilt},${h.accent},${h.attack}${style}`;
}

/** The lilt as a long:short ratio of a reel's quaver pair, e.g. "1.14:1" (or "1:1.14"). */
export function liltRatio(lilt: number): string {
	const a = (lilt / 100) * MAX_LILT;
	const ratio = (1 + Math.abs(a)) / (1 - Math.abs(a));
	const r = ratio.toFixed(2);
	return a >= 0 ? `${r}:1` : `1:${r}`;
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
 * stretched by `lilt` and the rest of the group squeezed to fit, piecewise linearly, so group
 * boundaries (and so bar lines) stay put and the order of everything is kept. Any time maps,
 * so triplets, grace notes and notes across groups scale consistently. A group missing its first
 * quaver (a pickup's) or with nothing after it is left as it is.
 */
export function liltWarp(
	groups: readonly Group[],
	grid: Grid,
	lilt: number
): (t: number) => number {
	const a = (Math.max(-100, Math.min(100, lilt)) / 100) * MAX_LILT;
	if (a === 0) return (t) => t;
	return (t) => {
		const g = groupAt(groups, t);
		if (!g || g.from > g.origin + EPS) return t;
		const p = g.origin + grid.unit;
		const rest = g.to - p;
		if (rest < EPS) return t;
		// In a short group, a shift in proportion to what's left of it.
		const shift = a * grid.unit * Math.min(1, rest / (grid.unit * (grid.group - 1)));
		if (t <= p) return g.origin + ((t - g.origin) * (grid.unit + shift)) / grid.unit;
		return p + shift + ((Math.min(t, g.to) - p) * (rest - shift)) / rest;
	};
}

/** Where a note starts on the grid: the strong position, another quaver, or off the grid. */
export type Stress = 'strong' | 'weak' | 'off';

export function stressAt(groups: readonly Group[], grid: Grid, style: HumanizeStyle, t: number) {
	const g = groupAt(groups, t);
	if (!g) return 'off' as Stress;
	const position = (t - g.origin) / grid.unit;
	const index = Math.round(position);
	if (!near(position, index)) return 'off' as Stress;
	const strong = style === 'oldtime' ? grid.group - 1 : 0;
	return (index === strong ? 'strong' : 'weak') as Stress;
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
 */
export function humanizeNotes(input: HumanizeInput): number[] {
	const { settings } = input;
	const grid = meterGrid(input.meter);
	if (!grid || isHumanizeOff(settings)) return [];
	const groups = beatGroups(input.barStarts, input.total, grid, input.copies);
	const warp = liltWarp(groups, grid, settings.lilt);
	const k = (Math.max(-100, Math.min(100, settings.accent)) / 100) * MAX_ACCENT;
	const strongGain = 1 + k;
	const weakGain = 1 - k / (grid.group - 1);
	const onsets = new Set<number>();
	for (const track of input.tracks) {
		for (const event of track) {
			if (event.cmd !== 'note' || event.start === undefined) continue;
			const start = event.start;
			const stress =
				event.style === 'grace' ? 'off' : stressAt(groups, grid, settings.style, start);
			if (settings.lilt) {
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
