// Tag playback profiles (PLAN.md §5, §14 "Tag playback profiles"): how a synthesized tune plays
// (instrument, times through, chords, lilt, accent, attack) is set per tag, in the synced Library
// doc, so it follows the user across devices. Profiles are ordered; the first one, in the
// profiles' own order, whose tag a piece has wins, whatever order the piece's tags are in. A
// Part also has its Tune's tags (the Part → Tune inheritance of derived.ts). Anything else uses
// the Default profile. A recording may override only the instrument (`clip.instrument`).
//
// CRDT shape (§5): profiles are a map keyed by `tagKey(tag)`, so the same tag added on two devices
// merges into one profile; their order is a fractional index; every setting is its own field, so
// concurrent edits to different settings merge.

import { getIndex } from './derived.ts';
import { HUMANIZE_OFF, clampLilt, type Humanize } from './humanize.ts';
import { canonicalTag, tagKey } from './ops.ts';
import { compareOrder, orderAfter, orderBetween, ordersAfter } from './order.ts';
import {
	DEFAULT_SYNTH_OPTIONS,
	MAX_TIMES_THROUGH,
	isInstrument,
	type InstrumentId,
	type SynthOptions
} from './synth.ts';
import type {
	Clip,
	Library,
	Piece,
	PlaybackProfile,
	PlaybackProfileSettings,
	PlaybackSettings
} from './types.ts';

/** What the Default profile is called in the UI. Its tag can't be used for a profile of its own. */
export const DEFAULT_PROFILE_LABEL = 'Default';

/** As written, on the default instrument. */
export const AS_WRITTEN: PlaybackProfileSettings = {
	instrument: DEFAULT_SYNTH_OPTIONS.instrument,
	timesThrough: DEFAULT_SYNTH_OPTIONS.timesThrough,
	chords: DEFAULT_SYNTH_OPTIONS.chords,
	...HUMANIZE_OFF
};

/**
 * The profiles a new (or newly migrated) library starts with, in this order. "Old Time" comes
 * first, so a reel tagged "Old Time" plays old-time rather than as a Reel. Reel and Jig match the
 * type tags thesession links add (`typeTag`, matched case-insensitively).
 */
export const SEED_PROFILES: readonly ({ tag: string } & Humanize)[] = [
	{ tag: 'Old Time', lilt: 1.5, accent: -20, attack: 0 },
	{ tag: 'Reel', lilt: 1, accent: 30, attack: 10 },
	{ tag: 'Jig', lilt: 1.1, accent: 30, attack: 10 }
];

/** The instrument, times through and chords from the per-device options of before schema 2. */
export type LegacySynthOptions = Partial<
	Pick<PlaybackProfileSettings, 'instrument' | 'timesThrough' | 'chords'>
>;

/**
 * Reads the old device-local options (`localStorage` `tunejournal.synth`) for the one-time import:
 * only the instrument, times through and chords, and only valid values.
 */
export function parseLegacySynthOptions(raw: string | null | undefined): LegacySynthOptions {
	if (!raw) return {};
	let v: Record<string, unknown>;
	try {
		v = JSON.parse(raw);
	} catch {
		return {};
	}
	if (!v || typeof v !== 'object') return {};
	const out: LegacySynthOptions = {};
	if (isInstrument(v.instrument)) out.instrument = v.instrument;
	const times = Number(v.timesThrough);
	if (Number.isInteger(times) && times >= 1 && times <= MAX_TIMES_THROUGH) out.timesThrough = times;
	if (typeof v.chords === 'boolean') out.chords = v.chords;
	return out;
}

/**
 * The initial profiles. `legacy` (this device's old options) sets the instrument, times through
 * and chords of all of them, so a device that played on the whistle keeps doing so.
 */
export function seedPlayback(legacy: LegacySynthOptions = {}): PlaybackSettings {
	const base = { ...AS_WRITTEN, ...legacy };
	const orders = ordersAfter([], SEED_PROFILES.length);
	const profiles: Record<string, PlaybackProfile> = {};
	SEED_PROFILES.forEach((seed, i) => {
		profiles[tagKey(seed.tag)] = { ...base, ...seed, order: orders[i] };
	});
	return { default: { ...base }, profiles };
}

/** The feel "Default" resets a profile to: its seeded one, or as written for other tags. */
export function seededFeel(key: string | undefined): Humanize {
	const seed = key === undefined ? undefined : SEED_PROFILES.find((s) => tagKey(s.tag) === key);
	return seed ? { lilt: seed.lilt, accent: seed.accent, attack: seed.attack } : { ...HUMANIZE_OFF };
}

const clampAmount = (v: unknown, fallback: number) => {
	const n = Math.round(Number(v));
	return Number.isFinite(n) ? Math.max(-100, Math.min(100, n)) : fallback;
};

/** A profile's settings with gaps filled and nonsense dropped (synced data may be anything). */
export function normalizeProfile(value: unknown): PlaybackProfileSettings {
	const v = (value && typeof value === 'object' ? value : {}) as Partial<PlaybackProfileSettings>;
	const times = Math.round(Number(v.timesThrough));
	return {
		instrument: isInstrument(v.instrument) ? v.instrument : AS_WRITTEN.instrument,
		timesThrough: times >= 1 && times <= MAX_TIMES_THROUGH ? times : AS_WRITTEN.timesThrough,
		chords: typeof v.chords === 'boolean' ? v.chords : AS_WRITTEN.chords,
		lilt: clampLilt(v.lilt, AS_WRITTEN.lilt),
		accent: clampAmount(v.accent, AS_WRITTEN.accent),
		attack: clampAmount(v.attack, AS_WRITTEN.attack)
	};
}

/** The library's playback settings (the seeded ones for a doc not yet migrated). */
export function playbackOf(lib: Pick<Library, 'settings'>): PlaybackSettings {
	return lib.settings.playback ?? SEEDED;
}
const SEEDED = seedPlayback();

/** One profile: a tag's, or the Default (`key` undefined). */
export interface ProfileEntry {
	/** `tagKey(tag)`; undefined for the Default. */
	key: string | undefined;
	/** The tag as shown ("Default" for the Default). */
	label: string;
	settings: PlaybackProfileSettings;
}

/** The tag profiles in priority order (ties, from concurrent moves, broken by key). */
export function sortedProfiles(playback: PlaybackSettings): ProfileEntry[] {
	return Object.entries(playback.profiles)
		.sort(([ka, a], [kb, b]) => compareOrder(a.order, b.order) || compareOrder(ka, kb))
		.map(([key, p]) => ({ key, label: p.tag, settings: normalizeProfile(p) }));
}

export function defaultProfile(playback: PlaybackSettings): ProfileEntry {
	return {
		key: undefined,
		label: DEFAULT_PROFILE_LABEL,
		settings: normalizeProfile(playback.default)
	};
}

/**
 * The profile for a set of tags: the first, in the profiles' order, whose tag is among them
 * (compared with `tagKey`, so case and spacing don't matter), else the Default. The order the
 * tags come in plays no part.
 */
export function matchProfile(playback: PlaybackSettings, tags: Iterable<string>): ProfileEntry {
	const have = new Set([...tags].map(tagKey));
	return sortedProfiles(playback).find((p) => have.has(p.key!)) ?? defaultProfile(playback);
}

/** A piece's tags for matching: its own, and a Part's Tune's (the one it inherits from). */
export function playbackTags(lib: Library, piece: Piece): string[] {
	const tags = Object.keys(piece.tags ?? {});
	const tune = piece.kind === 'part' ? getIndex(lib).inheritsFrom(piece) : undefined;
	return tune ? [...tags, ...Object.keys(tune.tags)] : tags;
}

/**
 * The profile a piece plays with. `extraTags` count as the piece's too: the picker's preview adds
 * the chosen tune's type tag, since a piece being linked doesn't have it yet.
 */
export function profileFor(
	lib: Library,
	piece: Piece | undefined,
	extraTags: readonly string[] = []
): ProfileEntry {
	const tags = piece ? playbackTags(lib, piece) : [];
	return matchProfile(playbackOf(lib), [...tags, ...extraTags]);
}

/** A profile as the renderer's options, with a recording's instrument override if it has one. */
export function synthOptionsOf(
	settings: PlaybackProfileSettings,
	instrument?: string
): SynthOptions {
	const s = normalizeProfile(settings);
	return {
		instrument: (isInstrument(instrument) ? instrument : s.instrument) as InstrumentId,
		timesThrough: s.timesThrough,
		chords: s.chords,
		humanize: { lilt: s.lilt, accent: s.accent, attack: s.attack }
	};
}

/** The options a piece's recording plays with: its profile's, plus the clip's instrument. */
export function synthOptionsFor(
	lib: Library,
	piece: Piece | undefined,
	clip?: Pick<Clip, 'instrument'>,
	extraTags: readonly string[] = []
): SynthOptions {
	return synthOptionsOf(profileFor(lib, piece, extraTags).settings, clip?.instrument);
}

// Edits. Each takes a mutable Library (inside `library.change`, or a plain object in tests).

/** The playback settings, created (seeded) in a doc that has none yet. */
function ensurePlayback(lib: Library): PlaybackSettings {
	lib.settings.playback ??= seedPlayback();
	return lib.settings.playback;
}

/**
 * Adds a profile for a tag, last before the Default, starting from the Default's instrument, times
 * through and chords and the tag's seeded feel (as written for other tags). Returns its key, or
 * undefined when the tag is blank, is "Default", or already has a profile.
 */
export function addProfile(lib: Library, tag: string): string | undefined {
	const key = tagKey(tag);
	if (!key || key === tagKey(DEFAULT_PROFILE_LABEL)) return undefined;
	const playback = ensurePlayback(lib);
	if (playback.profiles[key]) return undefined;
	const base = normalizeProfile(playback.default);
	playback.profiles[key] = {
		...base,
		...seededFeel(key),
		tag: canonicalTag(lib, tag) ?? tag.trim(),
		order: orderAfter(Object.values(playback.profiles).map((p) => p.order))
	};
	return key;
}

/** Removes a profile and returns a plain copy of it, for undo. */
export function removeProfile(lib: Library, key: string): PlaybackProfile | undefined {
	const playback = lib.settings.playback;
	const profile = playback?.profiles[key];
	if (!playback || !profile) return undefined;
	const copy = JSON.parse(JSON.stringify(profile)) as PlaybackProfile;
	delete playback.profiles[key];
	return copy;
}

/** Puts back a removed profile (undo), where it was. */
export function restoreProfile(lib: Library, key: string, profile: PlaybackProfile): void {
	ensurePlayback(lib).profiles[key] = { ...profile };
}

/** Moves a profile `delta` places earlier (negative) or later in the order. */
export function moveProfile(lib: Library, key: string, delta: number): boolean {
	const playback = lib.settings.playback;
	if (!playback?.profiles[key]) return false;
	const order = sortedProfiles(playback).map((p) => p.key!);
	const from = order.indexOf(key);
	const to = Math.max(0, Math.min(order.length - 1, from + delta));
	if (to === from) return false;
	const rest = order.filter((k) => k !== key);
	const before = rest[to - 1];
	const after = rest[to];
	playback.profiles[key].order = orderBetween(
		before === undefined ? null : playback.profiles[before].order,
		after === undefined ? null : playback.profiles[after].order
	);
	return true;
}

/**
 * Changes some of a profile's settings (`key` undefined: the Default's). Only fields that change
 * are written, each on its own, so concurrent edits to other settings merge.
 */
export function updateProfile(
	lib: Library,
	key: string | undefined,
	patch: Partial<PlaybackProfileSettings>
): boolean {
	const playback = ensurePlayback(lib);
	const target = key === undefined ? playback.default : playback.profiles[key];
	if (!target) return false;
	const next = normalizeProfile({ ...normalizeProfile(target), ...patch });
	let changed = false;
	for (const field of Object.keys(patch) as (keyof PlaybackProfileSettings)[]) {
		if (!(field in next) || target[field] === next[field]) continue;
		(target as unknown as Record<string, unknown>)[field] = next[field];
		changed = true;
	}
	return changed;
}
