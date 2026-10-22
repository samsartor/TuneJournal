// Plays YouTube clips through the IFrame Player API (PLAN.md §6.6, §7.1). The API script loads on
// first use. `end` in playerVars only stops the first play, so start/end and loop are enforced by
// polling, as in the M0 spike. setPlaybackRate honours any 0.05 step (verified in the spike), so
// the same speed control works here; YouTube applies its own pitch correction.

import {
	Listeners,
	type PlayableClip,
	type PlayerAdapter,
	type PlayerSnapshot
} from './adapter.ts';
import { clampRate, clampTime, clipBounds, endAction, playFrom, type Trim } from './bounds.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
type YTPlayer = any;
const w = () => globalThis as any;
/* eslint-enable @typescript-eslint/no-explicit-any */

export const IFRAME_API = 'https://www.youtube.com/iframe_api';

/** YT.PlayerState values. */
const STATE = { ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } as const;

let api: Promise<void> | undefined;

/** Loads the IFrame API once. */
export function loadYouTubeApi(): Promise<void> {
	if (w().YT?.Player) return Promise.resolve();
	api ??= new Promise<void>((resolve, reject) => {
		const previous = w().onYouTubeIframeAPIReady;
		w().onYouTubeIframeAPIReady = () => {
			previous?.();
			resolve();
		};
		const s = document.createElement('script');
		s.src = IFRAME_API;
		s.async = true;
		s.onerror = () => {
			api = undefined;
			reject(new Error('Couldn’t load YouTube. Are you offline?'));
		};
		document.head.append(s);
	});
	return api;
}

const POLL_MS = 100;
/** getCurrentTime() lags a seek, so ignore the end check briefly after jumping back. */
const RESTART_GRACE_MS = 500;

export class YouTubeAdapter implements PlayerAdapter {
	readonly kind = 'youtube' as const;
	#host: HTMLElement;
	#player?: YTPlayer;
	#ready?: Promise<void>;
	#videoId?: string;
	#trim: Trim = {};
	#loop = false;
	#rate = 1;
	#timer?: ReturnType<typeof setInterval>;
	#restartedAt = -Infinity;
	#listeners = new Listeners<PlayerSnapshot>();

	/** `host` holds the player iframe; it should stay in the document while playing. */
	constructor(host: HTMLElement) {
		this.#host = host;
	}

	get #duration(): number | undefined {
		const d = this.#player?.getDuration?.();
		return typeof d === 'number' && d > 0 ? d : undefined;
	}

	get #time(): number {
		const t = this.#player?.getCurrentTime?.();
		return typeof t === 'number' ? t : (this.#trim.start ?? 0);
	}

	get #playing(): boolean {
		const s = this.#player?.getPlayerState?.();
		return s === STATE.PLAYING || s === STATE.BUFFERING;
	}

	get #bounds() {
		return clipBounds(this.#trim, this.#duration);
	}

	#emit() {
		this.#listeners.emit({ time: this.#time, duration: this.#duration, playing: this.#playing });
	}

	async load(clip: PlayableClip): Promise<void> {
		if (!clip.videoId) throw new Error('No YouTube video id');
		this.#trim = { start: clip.start, end: clip.end };
		await loadYouTubeApi();
		const start = Math.floor(clip.start ?? 0);
		if (!this.#player) {
			const el = document.createElement('div');
			this.#host.replaceChildren(el);
			this.#ready = new Promise<void>((resolve, reject) => {
				this.#player = new (w().YT.Player)(el, {
					videoId: clip.videoId,
					width: '100%',
					height: '100%',
					playerVars: { start, playsinline: 1, rel: 0, modestbranding: 1 },
					events: {
						onReady: () => resolve(),
						onStateChange: (e: { data: number }) => this.#onState(e.data),
						onError: (e: { data: number }) => reject(new Error(youTubeError(e.data)))
					}
				});
			});
			await this.#ready;
		} else {
			await this.#ready;
			this.#player.cueVideoById({ videoId: clip.videoId, startSeconds: start });
		}
		this.#videoId = clip.videoId;
		this.#player.setPlaybackRate(this.#rate);
		await this.#waitForDuration();
		this.#emit();
	}

	/** The duration arrives a moment after cueing. */
	async #waitForDuration() {
		for (let i = 0; i < 30 && this.#duration === undefined; i++) {
			await new Promise((r) => setTimeout(r, 100));
		}
	}

	#onState(state: number) {
		if (state === STATE.PLAYING) {
			// The rate resets on a new video; apply it again once playing.
			if (this.#player.getPlaybackRate?.() !== this.#rate) this.#player.setPlaybackRate(this.#rate);
			this.#startPolling();
		} else if (state === STATE.ENDED && this.#loop) {
			this.#restart();
		}
		this.#emit();
	}

	async play(): Promise<void> {
		if (!this.#player || !this.#videoId) return;
		const b = this.#bounds;
		const from = playFrom(this.#time, b);
		if (Math.abs(from - this.#time) > 0.25) this.#player.seekTo(from, true);
		this.#player.playVideo();
		this.#startPolling();
	}

	pause(): void {
		this.#player?.pauseVideo();
		this.#emit();
	}

	seek(time: number): void {
		this.#player?.seekTo(clampTime(time, this.#bounds), true);
		this.#emit();
	}

	setRate(rate: number): void {
		this.#rate = clampRate(rate);
		this.#player?.setPlaybackRate(this.#rate);
	}

	setLoop(loop: boolean): void {
		this.#loop = loop;
	}

	setBounds(start?: number, end?: number): void {
		this.#trim = { start, end };
		const t = this.#time;
		const b = this.#bounds;
		if (t < b.start || t > b.end) this.#player?.seekTo(b.start, true);
	}

	onTime(listener: (snapshot: PlayerSnapshot) => void): () => void {
		return this.#listeners.add(listener);
	}

	setPitchShift(): void {
		// Not possible: we have no access to YouTube's audio.
	}

	#startPolling() {
		if (this.#timer) return;
		this.#timer = setInterval(() => this.#poll(), POLL_MS);
	}

	#stopPolling() {
		clearInterval(this.#timer);
		this.#timer = undefined;
	}

	#poll() {
		if (!this.#player) return;
		if (!this.#playing) {
			this.#stopPolling();
			this.#emit();
			return;
		}
		if (performance.now() - this.#restartedAt > RESTART_GRACE_MS) {
			const b = this.#bounds;
			const action = endAction(this.#time, b, this.#loop);
			if (action === 'loop') this.#restart();
			else if (action === 'stop') {
				this.#player.pauseVideo();
				this.#player.seekTo(b.end, true);
			}
		}
		this.#emit();
	}

	#restart() {
		this.#restartedAt = performance.now();
		this.#player.seekTo(this.#bounds.start, true);
		this.#player.playVideo();
	}

	destroy(): void {
		this.#stopPolling();
		this.#listeners.clear();
		try {
			this.#player?.destroy();
		} catch {
			// Already gone with its iframe.
		}
		this.#player = undefined;
		this.#host.replaceChildren();
	}
}

function youTubeError(code: number): string {
	switch (code) {
		case 2:
			return 'That YouTube link isn’t valid.';
		case 5:
			return 'YouTube couldn’t play this video here.';
		case 100:
			return 'This YouTube video was removed or made private.';
		case 101:
		case 150:
			return 'The owner doesn’t allow this video to play outside YouTube.';
		default:
			return `YouTube error ${code}.`;
	}
}
