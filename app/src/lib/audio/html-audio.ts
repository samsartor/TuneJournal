// Plays file sources (cached blobs or direct audio URLs) through <audio>, enforcing the clip's
// start/end ourselves, with pitch-preserving slow-down (PLAN.md §6.6).

import {
	Listeners,
	type PlayableClip,
	type PlayerAdapter,
	type PlayerSnapshot
} from './adapter.ts';
import { clampRate, clampTime, clipBounds, endAction, playFrom, type Trim } from './bounds.ts';

type PitchAudio = HTMLAudioElement & {
	webkitPreservesPitch?: boolean;
	mozPreservesPitch?: boolean;
};

/** Checks the end often enough to stop within ~1/30 s, rather than waiting for `timeupdate`. */
const TICK_MS = 30;

export class HtmlAudioAdapter implements PlayerAdapter {
	readonly kind = 'file' as const;
	readonly audio: PitchAudio;
	#trim: Trim = {};
	#loop = false;
	#rate = 1;
	#timer?: ReturnType<typeof setInterval>;
	#listeners = new Listeners<PlayerSnapshot>();
	#off: () => void;

	constructor(audio: HTMLAudioElement = new Audio()) {
		this.audio = audio as PitchAudio;
		this.audio.preload = 'auto';
		this.#preservePitch();
		const emit = () => this.#emit();
		const events = ['timeupdate', 'play', 'pause', 'loadedmetadata', 'durationchange', 'seeked'];
		for (const e of events) this.audio.addEventListener(e, emit);
		const ended = () => this.#onEnded();
		this.audio.addEventListener('ended', ended);
		this.#off = () => {
			for (const e of events) this.audio.removeEventListener(e, emit);
			this.audio.removeEventListener('ended', ended);
		};
	}

	#preservePitch() {
		// Unprefixed in Chromium and Firefox; Safari may still want the webkit name.
		this.audio.preservesPitch = true;
		this.audio.webkitPreservesPitch = true;
		this.audio.mozPreservesPitch = true;
	}

	get #bounds() {
		return clipBounds(this.#trim, this.#duration);
	}

	get #duration(): number | undefined {
		const d = this.audio.duration;
		return Number.isFinite(d) && d > 0 ? d : undefined;
	}

	#emit() {
		this.#listeners.emit({
			time: this.audio.currentTime,
			duration: this.#duration,
			playing: !this.audio.paused
		});
	}

	async load(clip: PlayableClip): Promise<void> {
		if (!clip.src) throw new Error('Nothing to play');
		this.#stopTicking();
		this.audio.pause();
		this.#trim = { start: clip.start, end: clip.end };
		const ready = new Promise<void>((resolve, reject) => {
			const done = () => {
				this.audio.removeEventListener('loadedmetadata', done);
				this.audio.removeEventListener('error', fail);
				resolve();
			};
			const fail = () => {
				this.audio.removeEventListener('loadedmetadata', done);
				this.audio.removeEventListener('error', fail);
				reject(new Error(mediaError(this.audio.error)));
			};
			this.audio.addEventListener('loadedmetadata', done);
			this.audio.addEventListener('error', fail);
		});
		this.audio.src = clip.src;
		this.audio.load();
		await ready;
		// Changing the source resets the rate to the default rate, so set both.
		this.setRate(this.#rate);
		this.#preservePitch();
		this.audio.currentTime = this.#bounds.start;
		this.#emit();
	}

	async play(): Promise<void> {
		const b = this.#bounds;
		const from = playFrom(this.audio.currentTime, b);
		if (from !== this.audio.currentTime) this.audio.currentTime = from;
		await this.audio.play();
		this.#startTicking();
	}

	pause(): void {
		this.audio.pause();
		this.#stopTicking();
	}

	seek(time: number): void {
		this.audio.currentTime = clampTime(time, this.#bounds);
	}

	setRate(rate: number): void {
		this.#rate = clampRate(rate);
		this.audio.defaultPlaybackRate = this.#rate;
		this.audio.playbackRate = this.#rate;
	}

	setLoop(loop: boolean): void {
		this.#loop = loop;
	}

	setBounds(start?: number, end?: number): void {
		this.#trim = { start, end };
		const b = this.#bounds;
		if (this.audio.currentTime < b.start || this.audio.currentTime > b.end) {
			this.audio.currentTime = b.start;
		}
	}

	onTime(listener: (snapshot: PlayerSnapshot) => void): () => void {
		return this.#listeners.add(listener);
	}

	setPitchShift(): void {
		// Reserved for the M8 time-stretch/pitch-shift engine.
	}

	#startTicking() {
		this.#stopTicking();
		this.#timer = setInterval(() => this.#tick(), TICK_MS);
	}

	#stopTicking() {
		clearInterval(this.#timer);
		this.#timer = undefined;
	}

	#tick() {
		if (this.audio.paused) return this.#stopTicking();
		const b = this.#bounds;
		switch (endAction(this.audio.currentTime, b, this.#loop)) {
			case 'loop':
				this.audio.currentTime = b.start;
				break;
			case 'stop':
				this.audio.pause();
				this.audio.currentTime = Number.isFinite(b.end) ? b.end : this.audio.currentTime;
				this.#stopTicking();
				break;
		}
	}

	/** The media itself ended (a clip without an end). */
	#onEnded() {
		if (this.#loop) {
			this.audio.currentTime = this.#bounds.start;
			void this.audio.play().catch(() => {});
		}
		this.#emit();
	}

	destroy(): void {
		this.#stopTicking();
		this.#off();
		this.#listeners.clear();
		this.audio.pause();
		this.audio.removeAttribute('src');
		this.audio.load();
	}
}

function mediaError(error: MediaError | null): string {
	switch (error?.code) {
		case 2:
			return 'The recording couldn’t be downloaded.';
		case 3:
		case 4:
			return 'This browser can’t play this recording’s format.';
		default:
			return 'The recording couldn’t be played.';
	}
}
