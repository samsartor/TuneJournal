// The player interface (PLAN.md §6.6). One adapter per way of playing a source: <audio> for files,
// the YouTube IFrame player, and opening a link elsewhere. The player store drives whichever fits
// the clip, so the bar, Shuffle and the trim editor never care which it is.

import type { Playback } from '#lib/domain/providers.ts';

/** What an adapter needs to play one clip, resolved from its Source by the player store. */
export interface PlayableClip {
	kind: Playback;
	/** `file`: a blob: URL from the audio cache, or a direct audio URL. */
	src?: string;
	/** `youtube`: the video id. */
	videoId?: string;
	/** The source's canonical link; what `link` opens. */
	url: string;
	/** Seconds. */
	start?: number;
	end?: number;
}

export interface PlayerSnapshot {
	/** Seconds into the media (not the clip). */
	time: number;
	/** The whole media's length, once known. */
	duration?: number;
	playing: boolean;
}

export interface PlayerAdapter {
	readonly kind: Playback;
	/** Loads a clip, paused at its start. Resolves once its duration is known (where possible). */
	load(clip: PlayableClip): Promise<void>;
	/** Plays from the current time, or from the clip start when outside the clip. */
	play(): Promise<void>;
	pause(): void;
	/** Seconds into the media; clamped to the clip. */
	seek(time: number): void;
	/** Playback rate, pitch preserved where the platform allows. */
	setRate(rate: number): void;
	/** Loop the clip: jump back to its start on reaching its end. */
	setLoop(loop: boolean): void;
	/** Changes the clip bounds in place, e.g. while previewing a trim. */
	setBounds(start?: number, end?: number): void;
	/** Called on every time or state change; returns an unsubscribe function. */
	onTime(listener: (snapshot: PlayerSnapshot) => void): () => void;
	/**
	 * Reserved for a time-stretch/pitch-shift engine (PLAN.md §6.6, deferred to M8). A no-op for
	 * now; YouTube will never support it, since we can't reach its audio.
	 */
	setPitchShift(semitones: number): void;
	destroy(): void;
}

/** Shared listener bookkeeping. */
export class Listeners<T> {
	#set = new Set<(value: T) => void>();

	add(listener: (value: T) => void): () => void {
		this.#set.add(listener);
		return () => this.#set.delete(listener);
	}

	emit(value: T) {
		for (const listener of this.#set) listener(value);
	}

	clear() {
		this.#set.clear();
	}
}
