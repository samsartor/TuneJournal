// Synthesized playback of thesession.org settings (PLAN.md §6.6, §14 "Synthesized playback"): the
// pure half. Which clip plays which setting, how a setting's ABC body becomes a whole tune to
// render (header, tempo, times through), the instruments and their sample ranges, and the audio
// cache key of a rendering. The browser half (abcjs, Web Audio) is in audio/synth.ts.

import { HUMANIZE_OFF, humanizeKey, type Humanize } from './humanize.ts';
import { parseKey } from './key.ts';
import type { Piece, Source } from './types.ts';

/** Bump when renderings change (instrument mapping, mixing), so stale cached audio is ignored. */
export const SYNTH_VERSION = 2;

export type InstrumentId = 'fiddle' | 'flute' | 'whistle' | 'accordion' | 'piano';

export interface Instrument {
	label: string;
	/** General MIDI program. */
	program: number;
	/** The soundfont's folder name (abcjs' instrument name for the program). */
	sample: string;
	/** Semitones added to the written pitch: tin whistle music is written an octave low. */
	octave: number;
}

export const INSTRUMENTS: Record<InstrumentId, Instrument> = {
	fiddle: { label: 'Fiddle', program: 40, sample: 'violin', octave: 0 },
	flute: { label: 'Flute', program: 73, sample: 'flute', octave: 0 },
	whistle: { label: 'Whistle', program: 78, sample: 'whistle', octave: 12 },
	accordion: { label: 'Accordion', program: 21, sample: 'accordion', octave: 0 },
	piano: { label: 'Piano', program: 0, sample: 'acoustic_grand_piano', octave: 0 }
};

export const INSTRUMENT_IDS = Object.keys(INSTRUMENTS) as InstrumentId[];

/**
 * The MIDI pitches self-hosted for each soundfont instrument (static/soundfont/, fetched by
 * scripts/fetch-soundfont.js). Notes outside are folded in by octaves (`foldPitch`), so the
 * renderer never asks for a sample that isn't there. Chord accompaniment uses the piano.
 */
export const SOUNDFONT_RANGES: Record<string, readonly [number, number]> = {
	violin: [55, 88],
	flute: [60, 93],
	whistle: [72, 98],
	accordion: [53, 88],
	acoustic_grand_piano: [36, 88]
};

/** Moves a pitch by whole octaves until it's inside `[lo, hi]` (which spans at least one). */
export function foldPitch(pitch: number, [lo, hi]: readonly [number, number]): number {
	let p = pitch;
	while (p < lo) p += 12;
	while (p > hi) p -= 12;
	return p < lo ? lo : p;
}

/**
 * Everything about how a tune is synthesized, as resolved for one piece: its tag playback profile
 * (domain/playback.ts), with the recording's instrument override if it has one.
 */
export interface SynthOptions {
	instrument: InstrumentId;
	/** Times through the whole tune, its own repeats included. */
	timesThrough: number;
	/** Play the setting's chord symbols (if it has any) on piano with a bass. */
	chords: boolean;
	/** Lilt, accent and attack on the strong quavers (see humanize.ts). */
	humanize: Humanize;
}

export const DEFAULT_SYNTH_OPTIONS: SynthOptions = {
	instrument: 'fiddle',
	timesThrough: 2,
	chords: false,
	humanize: HUMANIZE_OFF
};

export const MAX_TIMES_THROUGH = 4;

export function isInstrument(value: unknown): value is InstrumentId {
	return typeof value === 'string' && Object.hasOwn(INSTRUMENTS, value);
}

/** A tempo as ABC's `Q:` gives it: `bpm` beats of `unit` (a fraction of a whole note) a minute. */
export interface Tempo {
	/** The beat as a fraction of a whole note, e.g. 1/2 for a reel's minim. */
	unit: [number, number];
	bpm: number;
}

interface TuneType {
	meter: string;
	tempo: Tempo;
}

/**
 * Meter and default tempo per thesession tune type, for settings whose ABC has no `Q:` (thesession
 * bodies never do). Moderate session tempos, a little on the steady side for learning; the speed
 * control goes from there.
 */
export const TUNE_TYPES: Record<string, TuneType> = {
	reel: { meter: '4/4', tempo: { unit: [1, 2], bpm: 100 } },
	jig: { meter: '6/8', tempo: { unit: [3, 8], bpm: 110 } },
	'slip jig': { meter: '9/8', tempo: { unit: [3, 8], bpm: 115 } },
	hornpipe: { meter: '4/4', tempo: { unit: [1, 2], bpm: 80 } },
	polka: { meter: '2/4', tempo: { unit: [1, 4], bpm: 130 } },
	slide: { meter: '12/8', tempo: { unit: [3, 8], bpm: 130 } },
	waltz: { meter: '3/4', tempo: { unit: [1, 4], bpm: 120 } },
	barndance: { meter: '4/4', tempo: { unit: [1, 2], bpm: 85 } },
	strathspey: { meter: '4/4', tempo: { unit: [1, 4], bpm: 120 } },
	mazurka: { meter: '3/4', tempo: { unit: [1, 4], bpm: 120 } },
	'three-two': { meter: '3/2', tempo: { unit: [1, 2], bpm: 90 } }
};

/** Anything else (an unknown type): common time at a walking pace. */
export const FALLBACK_TYPE: TuneType = { meter: '4/4', tempo: { unit: [1, 4], bpm: 120 } };

export function tuneType(type: string | undefined): TuneType {
	const key = (type ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
	return TUNE_TYPES[key] ?? FALLBACK_TYPE;
}

/** Seconds per whole note at a tempo. */
export function secondsPerWhole(tempo: Tempo): number {
	const [n, d] = tempo.unit;
	return 60 / (tempo.bpm * (n / d));
}

/**
 * The tempo in an ABC `Q:` field, if it has a usable one: `Q:1/2=100`, `Q: 3/8=110`,
 * `Q:"Briskly" 1/4=120`. A bare `Q:120` (deprecated) counts quarter notes.
 */
export function parseTempo(abc: string): Tempo | undefined {
	const field = /(?:^|\n|\[)\s*Q:\s*([^\]\n]*)/.exec(abc)?.[1];
	if (!field) return undefined;
	const text = field.replace(/"[^"]*"/g, ' ');
	const full = /(\d+)\s*\/\s*(\d+)(?:\s+\d+\s*\/\s*\d+)*\s*=\s*(\d+(?:\.\d+)?)/.exec(text);
	if (full) {
		const [n, d, bpm] = [Number(full[1]), Number(full[2]), Number(full[3])];
		return n > 0 && d > 0 && bpm > 0 ? { unit: [n, d], bpm } : undefined;
	}
	const bare = /^\s*(\d+(?:\.\d+)?)\s*$/.exec(text);
	if (bare && Number(bare[1]) > 0) return { unit: [1, 4], bpm: Number(bare[1]) };
	return undefined;
}

/** A key as an ABC `K:` value: "E dorian" / "Edorian" → "Edor", "D major" → "Dmaj". */
export function abcKey(key: string | undefined): string {
	const parsed = key ? parseKey(key) : undefined;
	if (!parsed) return 'C';
	return parsed.tonic + parsed.mode.slice(0, 3);
}

export interface SettingAbc {
	/** The setting body (thesession's `abc`: no header, `!` marks line breaks). */
	abc: string;
	/** thesession's key, e.g. "Edorian". */
	key?: string;
	/** thesession's tune type, e.g. "slip jig". */
	type?: string;
	title?: string;
}

export interface TuneAbc {
	/** A complete tune: header, then the body `timesThrough` times. */
	abc: string;
	/** The tempo it's rendered at for 100%, from its own `Q:` or the tune type's default. */
	tempo: Tempo;
	/** Whether that tempo came from the ABC itself. */
	ownTempo: boolean;
	/** How many copies of the body `abc` has (each starts with the same pickup). */
	timesThrough: number;
}

/** Fields in a body that change the key, meter or note length for the rest of the tune. */
const RESETTING_FIELD = /(?:^|\n|\[)\s*[KML]:/;

/**
 * A setting's body as a complete tune for abcjs: an `X/T/R/M/L/Q/K` header (meter from the tune
 * type, key from the setting, `Q:` unless the body has its own), then the body `timesThrough`
 * times on separate lines. abcjs expands the body's own repeats and endings. A body that changes
 * key, meter or note length part-way gets the header's values restated before each repeat, so the
 * second time through starts like the first.
 */
export function buildTuneAbc(setting: SettingAbc, timesThrough = 2): TuneAbc {
	const type = tuneType(setting.type);
	const body = setting.abc
		.replace(/\r\n?/g, '\n')
		.replace(/!/g, '\n')
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean)
		.join('\n');
	const own = parseTempo(body);
	const tempo = own ?? type.tempo;
	const key = abcKey(setting.key);
	const header = [
		'X:1',
		`T:${(setting.title ?? 'Tune').replace(/\n/g, ' ')}`,
		...(setting.type ? [`R:${setting.type}`] : []),
		`M:${type.meter}`,
		'L:1/8',
		...(own ? [] : [`Q:${tempo.unit[0]}/${tempo.unit[1]}=${tempo.bpm}`]),
		`K:${key}`
	];
	const restate = RESETTING_FIELD.test(body) ? `M:${type.meter}\nL:1/8\nK:${key}\n` : '';
	const times = Math.max(1, Math.min(MAX_TIMES_THROUGH, Math.round(timesThrough)));
	const copies = Array.from({ length: times }, (_, i) => (i > 0 ? restate : '') + body);
	return {
		abc: `${header.join('\n')}\n${copies.join('\n')}\n`,
		tempo,
		ownTempo: !!own,
		timesThrough: times
	};
}

/**
 * Everything a rendering depends on. `tempo` is the speed as a factor of the tune's 100% tempo
 * (the player's rate), rounded to 1%, since the renderer re-renders rather than time-stretches.
 */
export interface RenderRequest {
	abc: string;
	/** Seconds per whole note at 100%. */
	wholeNote: number;
	tempo: number;
	instrument: InstrumentId;
	chords: boolean;
	/** Semitones (the reserved pitch-shift hook). */
	transpose: number;
	/** Copies of the tune in `abc` (already in its hash; humanization finds pickups with it). */
	timesThrough: number;
	humanize: Humanize;
}

export function roundTempo(rate: number): number {
	return Math.round(rate * 100) / 100;
}

export function renderRequest(
	tune: TuneAbc,
	options: SynthOptions,
	rate = 1,
	transpose = 0
): RenderRequest {
	return {
		abc: tune.abc,
		wholeNote: secondsPerWhole(tune.tempo),
		tempo: roundTempo(rate),
		instrument: options.instrument,
		chords: options.chords,
		transpose: Math.round(transpose),
		timesThrough: tune.timesThrough,
		humanize: options.humanize
	};
}

/** FNV-1a, as 8 hex digits: enough to tell one setting's ABC from an edited one. */
export function hashText(text: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0).toString(16).padStart(8, '0');
}

export const SYNTH_CACHE_PREFIX = 'synth:';

/**
 * The audio cache id of a rendering, minus its tempo: every input but the speed. Renderings of
 * one tune at other speeds share it, so older ones can be pruned.
 */
export function synthCacheFamily(settingId: number, request: RenderRequest): string {
	const parts: string[] = [
		`v${SYNTH_VERSION}`,
		`s${settingId}`,
		hashText(request.abc),
		request.instrument,
		request.chords ? 'chords' : 'melody',
		...(request.transpose ? [`t${request.transpose}`] : []),
		// None when off, so plain renderings keep their keys.
		...[humanizeKey(request.humanize)].filter((part) => part !== undefined)
	];
	return `${SYNTH_CACHE_PREFIX}${parts.join(':')}`;
}

/** The audio cache id of a rendering: its family plus the tempo, e.g. `…@0.75`. */
export function synthCacheKey(settingId: number, request: RenderRequest): string {
	return `${synthCacheFamily(settingId, request)}@${request.tempo.toFixed(2)}`;
}

export function isSynthCacheKey(id: string): boolean {
	return id.startsWith(SYNTH_CACHE_PREFIX);
}

export interface SynthTarget {
	tuneId: number;
	settingId: number;
}

/**
 * The thesession setting a recording would synthesize: the piece's chosen setting, when the clip
 * is the piece's link to that same tune. Set links, links to other tunes, and tunes with no
 * chosen setting have none (they open thesession.org instead).
 */
export function synthTarget(
	piece: Pick<Piece, 'external'>,
	source: Pick<Source, 'provider' | 'externalId'>
): SynthTarget | undefined {
	if (source.provider !== 'thesession' || !source.externalId) return undefined;
	if (!/^\d+$/.test(source.externalId)) return undefined;
	const tuneId = Number(source.externalId);
	const ts = piece.external?.thesession;
	if (ts?.tuneId !== tuneId || ts.settingId === undefined) return undefined;
	return { tuneId, settingId: ts.settingId };
}
