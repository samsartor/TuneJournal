// Renders a thesession setting's ABC to a WAV with abcjs (PLAN.md §6.6, §14 "Synthesized
// playback"). abcjs is loaded on first use, so it never weighs on the first page load. Samples
// come from the self-hosted soundfont (static/soundfont/), which the service worker caches as they
// are fetched, so rendering works offline once an instrument has been heard.
//
// abcjs renders through "the" AudioContext. We hand it a stand-in that decodes into an
// OfflineAudioContext at our own sample rate and creates plain AudioBuffers: no real context means
// no autoplay-policy wait (renders happen before any tap, e.g. Shuffle loading a card paused) and
// a smaller file. The finished buffer is mixed to mono, normalized and encoded as 16-bit WAV.

import type { AudioTrack, AudioTracks, TuneObject } from 'abcjs';
import { INSTRUMENTS, SOUNDFONT_RANGES, foldPitch, type RenderRequest } from '#lib/domain/synth.ts';
import { encodeWav } from './wav.ts';

/** Enough for fiddle and whistle overtones, and a third smaller than 48 kHz. */
export const SAMPLE_RATE = 32000;

/**
 * Each note fades out over its last 20 ms, so it's silent by its written end. abcjs 6 holds a note
 * to its end and only then fades it, over 200 ms by default: at reel tempo (150 ms quavers) that
 * left two or three sustained fiddle or accordion notes sounding at once. abcjs 5, which
 * thesession.org plays with, cut notes off at their end; a short fade does the same without a click.
 * No `programOffsets` either: they start a note early *and* lengthen it by as much, so its attack
 * overlapped the end of the note before.
 */
const RELEASE_MS = 20;

/** The loudest sample of a rendering, so every tune and instrument plays at the same level. */
const PEAK = 0.89;

type Abcjs = typeof import('abcjs');

let loading: Promise<{ abcjs: Abcjs; sounds: Record<string, Record<string, unknown>> }> | undefined;

/** abcjs itself, loaded on first use (the notation view uses it too). */
export async function abcjsLibrary(): Promise<Abcjs> {
	return (await loadAbcjs()).abcjs;
}

/** abcjs and its decoded-sample cache, loaded once. */
function loadAbcjs() {
	loading ??= Promise.all([import('abcjs'), import('abcjs/src/synth/sounds-cache.js')]).then(
		([lib, cache]) => ({
			abcjs: ((lib as { default?: Abcjs }).default ?? lib) as Abcjs,
			sounds: ((cache as { default?: object }).default ?? cache) as Record<
				string,
				Record<string, unknown>
			>
		})
	);
	loading.catch(() => (loading = undefined));
	return loading;
}

/** Starts fetching abcjs ahead of a render (e.g. when a synth clip comes into view). */
export function preloadSynth() {
	void loadAbcjs().catch(() => {});
}

export class SynthError extends Error {
	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = 'SynthError';
	}
}

/** The part of AudioContext abcjs uses while loading samples and building its buffer. */
function renderContext(sampleRate: number): AudioContext {
	const decoder = new OfflineAudioContext(1, 1, sampleRate);
	const context = {
		sampleRate,
		currentTime: 0,
		state: 'running',
		decodeAudioData: (
			data: ArrayBuffer,
			ok?: (buffer: AudioBuffer) => void,
			fail?: (error: DOMException) => void
		) => decoder.decodeAudioData(data, ok, fail),
		createBuffer: (channels: number, length: number, rate: number) =>
			new AudioBuffer({
				numberOfChannels: channels,
				length: Math.max(1, length),
				sampleRate: rate
			}),
		resume: async () => {},
		suspend: async () => {}
	};
	return context as unknown as AudioContext;
}

/**
 * Puts every note on an instrument we have samples for, inside its sampled range: the melody on
 * the chosen instrument (an octave up for whistle), chords and bass on the piano. A setting's own
 * `%%MIDI program` lines are overridden, since we only ship a few instruments.
 */
export function fitToSoundfont(tracks: AudioTrack[], request: RenderRequest): void {
	const melody = INSTRUMENTS[request.instrument];
	const piano = INSTRUMENTS.piano;
	for (const track of tracks) {
		for (const event of track) {
			if (event.cmd === 'program') {
				if (event.instrument !== piano.program) event.instrument = melody.program;
			} else if (event.cmd === 'note') {
				const accompaniment =
					event.instrument === piano.program && melody.program !== piano.program;
				if (!accompaniment) event.instrument = melody.program;
				const inst = accompaniment ? piano : melody;
				const shift = accompaniment ? 0 : inst.octave;
				event.pitch = foldPitch(event.pitch + shift, SOUNDFONT_RANGES[inst.sample]);
			}
		}
	}
}

export interface Rendering {
	blob: Blob;
	/** Seconds. */
	duration: number;
}

/**
 * Renders a tune to a WAV blob. `soundFontUrl` is where the per-note MP3s are (ending in `/`).
 * Fails with a SynthError explaining what went wrong (unreadable ABC, samples not loaded).
 */
export async function renderTune(request: RenderRequest, soundFontUrl: string): Promise<Rendering> {
	const { abcjs, sounds } = await loadAbcjs().catch((e) => {
		throw new SynthError('Couldn’t load the synthesizer.', { cause: e });
	});
	const [tune] = abcjs.parseOnly(request.abc) as TuneObject[];
	if (!tune || tune.lines.length === 0)
		throw new SynthError('This setting’s ABC couldn’t be read.');

	const melody = INSTRUMENTS[request.instrument];
	const sequence = tune.setUpAudio({
		program: melody.program,
		midiTranspose: request.transpose,
		chordsOff: !request.chords
	}) as AudioTracks;
	fitToSoundfont(sequence.tracks, request);
	if (!(sequence.totalDuration > 0)) throw new SynthError('This setting has no notes to play.');

	abcjs.synth.registerAudioContext(renderContext(SAMPLE_RATE));
	const synth = new abcjs.synth.CreateSynth();
	try {
		await synth.init({
			// `sequence` rather than `visualObj`: abcjs then times notes by the whole note
			// (millisecondsPerMeasure is per 1/1 here), so any meter and tempo map directly.
			sequence: sequence as never,
			millisecondsPerMeasure: (request.wholeNote * 1000) / request.tempo,
			options: {
				soundFontUrl,
				soundFontVolumeMultiplier: 1,
				fadeLength: RELEASE_MS,
				// Shortens each note by this much (abcjs reads it, its types don't list it).
				...{ noteEnd: RELEASE_MS }
			}
		});
		await synth.prime();
	} catch (e) {
		// abcjs keeps failed sample loads as rejected promises; drop them so a later try refetches.
		for (const name of Object.keys(sounds)) delete sounds[name];
		throw new SynthError(
			navigator.onLine
				? 'Couldn’t load the instrument sounds.'
				: 'The instrument sounds aren’t on this device yet. Play it once while online.',
			{ cause: e }
		);
	}
	const buffer = synth.getAudioBuffer();
	if (!buffer || buffer.length <= 1) throw new SynthError('This setting has no notes to play.');
	const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) =>
		buffer.getChannelData(i)
	);
	const wav = encodeWav(channels, buffer.sampleRate, { mono: true, normalize: PEAK });
	return { blob: new Blob([wav], { type: 'audio/wav' }), duration: buffer.duration };
}
