// Plays a synthesized thesession setting (PLAN.md §6.6, §14 "Synthesized playback") through the
// <audio> adapter, so loop, trim, scrubbing and the waveform behave exactly as for a recording.
//
// Speed re-renders rather than time-stretches: synthesized notes sound far better rendered at the
// target tempo. Everything the player sees is in *tune time*, the tune's seconds at 100%, so the
// clip's trim and the playhead mean the same bar at every speed: a rendering at tempo k has media
// time = tune time / k. Until the rendering at a new speed is ready (a fraction of a second, or
// instant from the cache), the current one plays at the corrected rate with pitch preserved, and
// then the new one takes over at the same place in the tune.

import { roundTempo } from '#lib/domain/synth.ts';
import {
	Listeners,
	type PlayableClip,
	type PlayerAdapter,
	type PlayerSnapshot
} from './adapter.ts';
import { clampRate, type Trim } from './bounds.ts';
import { HtmlAudioAdapter } from './html-audio.ts';

/** Renders the tune at `tempo` × its 100% tempo, transposed by `transpose` semitones. */
export type SynthRenderer = (tempo: number, transpose: number) => Promise<Blob>;

/** Waits for the speed to settle (±5% taps) before re-rendering. */
const RERENDER_DELAY_MS = 300;

const scale = (t: number | undefined, factor: number) => (t === undefined ? undefined : t * factor);

export class SynthAdapter implements PlayerAdapter {
	readonly kind = 'synth' as const;
	readonly inner: HtmlAudioAdapter;
	#render: SynthRenderer;
	#listeners = new Listeners<PlayerSnapshot>();
	#offInner: () => void;
	/** The tempo of the loaded rendering. */
	#tempo = 1;
	/** The speed asked for. */
	#rate = 1;
	#transpose = 0;
	#trim: Trim = {};
	#loop = false;
	#url?: string;
	#swapping = false;
	#timer?: ReturnType<typeof setTimeout>;
	#token = 0;
	#destroyed = false;
	#swaps: Promise<void> = Promise.resolve();

	constructor(render: SynthRenderer, audio?: HTMLAudioElement) {
		this.#render = render;
		this.inner = new HtmlAudioAdapter(audio);
		this.#offInner = this.inner.onTime((s) => {
			if (this.#swapping) return;
			this.#listeners.emit(this.#toTune(s));
		});
	}

	/** The loaded rendering's tempo (for tests and the UI's "rendering…" hint). */
	get tempo(): number {
		return this.#tempo;
	}

	/** A re-render for the current speed is pending. */
	get rerendering(): boolean {
		return this.#timer !== undefined || this.#swapping;
	}

	#toTune(s: PlayerSnapshot): PlayerSnapshot {
		return {
			time: s.time * this.#tempo,
			duration: scale(s.duration, this.#tempo),
			playing: s.playing,
			renderedTempo: this.#tempo
		};
	}

	/** Media-time bounds for the inner adapter. */
	#mediaTrim(tempo: number) {
		return { start: scale(this.#trim.start, 1 / tempo), end: scale(this.#trim.end, 1 / tempo) };
	}

	async load(clip: PlayableClip): Promise<void> {
		this.#trim = { start: clip.start, end: clip.end };
		const tempo = roundTempo(this.#rate);
		const blob = await this.#render(tempo, this.#transpose);
		if (this.#destroyed) return;
		await this.#swapIn(blob, tempo, clip.url);
	}

	/** Loads a rendering, keeping the place in the tune and whether it was playing. */
	async #swapIn(blob: Blob, tempo: number, url = '', at?: number, resume = false) {
		const old = this.#url;
		this.#url = URL.createObjectURL(blob);
		this.#swapping = at !== undefined;
		try {
			const media = this.#mediaTrim(tempo);
			// Before loading, so the events it fires already convert at the new tempo.
			this.#tempo = tempo;
			await this.inner.load({ kind: 'file', src: this.#url, url, ...media });
			this.inner.setRate(this.#rate / tempo);
			this.inner.setLoop(this.#loop);
			if (at !== undefined) this.inner.seek(at / tempo);
			if (resume) await this.inner.play();
		} finally {
			this.#swapping = false;
			if (old) URL.revokeObjectURL(old);
			this.#emit();
		}
	}

	#emit() {
		const audio = this.inner.audio;
		const d = audio.duration;
		this.#listeners.emit(
			this.#toTune({
				time: audio.currentTime,
				duration: Number.isFinite(d) && d > 0 ? d : undefined,
				playing: !audio.paused
			})
		);
	}

	/** Re-renders at the current speed and transposition, then swaps it in at the same place. */
	rerender({ force = false } = {}) {
		clearTimeout(this.#timer);
		this.#timer = undefined;
		const tempo = roundTempo(this.#rate);
		if (!this.#url || (!force && tempo === this.#tempo)) return;
		const token = ++this.#token;
		const rendered = this.#render(tempo, this.#transpose);
		rendered.catch(() => {}); // Reported below, once its turn comes.
		// One swap at a time: the place in the tune is read once the previous one is done.
		this.#swaps = this.#swaps
			.then(() => rendered)
			.then(async (blob) => {
				if (token !== this.#token || this.#destroyed) return;
				const audio = this.inner.audio;
				const at = audio.currentTime * this.#tempo;
				await this.#swapIn(blob, tempo, '', at, !audio.paused);
			})
			.catch((e) => {
				// The stretched rendering keeps playing; only the sound quality suffers.
				if (token === this.#token) console.warn('Couldn’t re-render at the new speed', e);
			});
	}

	play(): Promise<void> {
		return this.inner.play();
	}

	pause(): void {
		this.inner.pause();
	}

	seek(time: number): void {
		this.inner.seek(time / this.#tempo);
	}

	setRate(rate: number): void {
		this.#rate = clampRate(rate);
		this.inner.setRate(this.#rate / this.#tempo);
		if (!this.#url) return;
		clearTimeout(this.#timer);
		this.#timer = undefined;
		if (roundTempo(this.#rate) === this.#tempo) {
			this.#token++; // A pending re-render for another speed is no longer wanted.
			return;
		}
		this.#timer = setTimeout(() => this.rerender(), RERENDER_DELAY_MS);
	}

	setLoop(loop: boolean): void {
		this.#loop = loop;
		this.inner.setLoop(loop);
	}

	setBounds(start?: number, end?: number): void {
		this.#trim = { start, end };
		const media = this.#mediaTrim(this.#tempo);
		this.inner.setBounds(media.start, media.end);
	}

	onTime(listener: (snapshot: PlayerSnapshot) => void): () => void {
		return this.#listeners.add(listener);
	}

	/** Transposes by re-rendering (abcjs' midiTranspose); not yet offered in the UI. */
	setPitchShift(semitones: number): void {
		const next = Math.round(semitones);
		if (next === this.#transpose) return;
		this.#transpose = next;
		if (this.#url) this.rerender({ force: true });
	}

	destroy(): void {
		this.#destroyed = true;
		this.#token++;
		clearTimeout(this.#timer);
		this.#offInner();
		this.#listeners.clear();
		this.inner.destroy();
		if (this.#url) URL.revokeObjectURL(this.#url);
		this.#url = undefined;
	}
}
