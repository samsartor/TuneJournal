// The global player (PLAN.md §6.6): one clip at a time, shown in the mini-player bar, driven
// through whichever PlayerAdapter fits the clip's source. Speed is remembered per device as the
// default for the next session; loop stays on until turned off.

import { playbackOf, type Playback } from '#lib/domain/providers.ts';
import type { Clip, ClipId, PieceId, Source } from '#lib/domain/types.ts';
import { audioFiles } from '#lib/store/audio.svelte.ts';
import { library } from '#lib/store/library.svelte.ts';
import type { PlayableClip, PlayerAdapter } from './adapter.ts';
import { clampRate, clipBounds, type Trim } from './bounds.ts';
import { HtmlAudioAdapter } from './html-audio.ts';
import { LinkOutAdapter } from './link-out.ts';
import { YouTubeAdapter } from './youtube.ts';

const RATE_KEY = 'tunejournal.player.rate';

function readRate(): number {
	try {
		const stored = Number(globalThis.localStorage?.getItem(RATE_KEY));
		return stored ? clampRate(stored) : 1;
	} catch {
		return 1;
	}
}

export interface NowPlaying {
	pieceId: PieceId;
	clipId: ClipId;
	sourceId: Source['id'];
}

export interface OpenOptions {
	/** Start playing once loaded (default true). */
	autoplay?: boolean;
}

class PlayerStore {
	current = $state<NowPlaying>();
	kind = $state<Playback>();
	loading = $state(false);
	error = $state<string>();
	playing = $state(false);
	/** Seconds into the media. */
	time = $state(0);
	duration = $state<number>();
	rate = $state(readRate());
	loop = $state(false);
	/** The trim in effect: the clip's, or a preview from the trim editor. */
	trim = $state<Trim>({});
	previewing = $state(false);
	readonly bounds = $derived(clipBounds(this.trim, this.duration));

	#adapter?: PlayerAdapter;
	#off?: () => void;
	#objectUrl?: string;
	#videoHost?: HTMLElement;
	#loadToken = 0;
	#link = new LinkOutAdapter();

	/** The bar's element for the YouTube iframe. */
	setVideoHost(el: HTMLElement | undefined) {
		this.#videoHost = el;
	}

	isCurrent(pieceId: PieceId, clipId: ClipId): boolean {
		return this.current?.pieceId === pieceId && this.current.clipId === clipId;
	}

	#lookup(pieceId: PieceId, clipId: ClipId): { clip: Clip; source: Source } | undefined {
		const clip = library.doc?.pieces[pieceId]?.clips[clipId];
		const source = clip && library.doc?.sources[clip.sourceId];
		return clip && source ? { clip, source } : undefined;
	}

	/**
	 * Loads a clip into the bar and (by default) plays it. A link-only clip opens in a new tab
	 * instead, leaving whatever is playing alone.
	 */
	async open(pieceId: PieceId, clipId: ClipId, { autoplay = true }: OpenOptions = {}) {
		const found = this.#lookup(pieceId, clipId);
		if (!found) return;
		const { clip, source } = found;
		const kind = playbackOf(source);
		if (kind === 'link') {
			await this.#link.load({ kind, url: source.url });
			if (autoplay) await this.#link.play();
			return;
		}
		if (this.isCurrent(pieceId, clipId) && !this.error && !this.loading) {
			this.endPreview();
			if (autoplay) await this.play();
			return;
		}

		const token = ++this.#loadToken;
		this.#teardown();
		this.current = { pieceId, clipId, sourceId: source.id };
		this.kind = kind;
		this.loading = true;
		this.error = undefined;
		this.playing = false;
		this.previewing = false;
		this.trim = { start: clip.start, end: clip.end };
		this.time = clip.start ?? 0;
		this.duration = source.durationSec;
		try {
			const playable = await this.#resolve(kind, clip, source);
			if (token !== this.#loadToken) return;
			const adapter = this.#adapterFor(kind);
			this.#adapter = adapter;
			this.#off = adapter.onTime((s) => {
				this.time = s.time;
				if (s.duration !== undefined) this.duration = s.duration;
				this.playing = s.playing;
			});
			adapter.setRate(this.rate);
			adapter.setLoop(this.loop);
			await adapter.load(playable);
			if (token !== this.#loadToken) return;
			this.loading = false;
			if (autoplay) await this.play();
		} catch (e) {
			if (token !== this.#loadToken) return;
			console.warn('Couldn’t play recording', e);
			this.loading = false;
			this.error = e instanceof Error ? e.message : String(e);
		}
	}

	async #resolve(kind: Playback, clip: Clip, source: Source): Promise<PlayableClip> {
		const base = { kind, url: source.url, start: clip.start, end: clip.end };
		if (kind === 'youtube') return { ...base, videoId: source.externalId };
		// A remote audio URL we merely link to plays straight from the web unless it's cached.
		if (source.provider === 'url' && !audioFiles.cached(source.id))
			return { ...base, src: source.url };
		const blob = await audioFiles.blobFor(source);
		this.#revoke();
		this.#objectUrl = URL.createObjectURL(blob);
		return { ...base, src: this.#objectUrl };
	}

	#adapterFor(kind: Playback): PlayerAdapter {
		if (kind === 'youtube') {
			if (!this.#videoHost) throw new Error('The video player isn’t ready');
			return new YouTubeAdapter(this.#videoHost);
		}
		return new HtmlAudioAdapter();
	}

	async play() {
		if (!this.#adapter) {
			if (this.current) await this.open(this.current.pieceId, this.current.clipId);
			return;
		}
		try {
			await this.#adapter.play();
		} catch (e) {
			// An interrupted play() (pause or seek while starting) isn't worth reporting.
			if (!(e instanceof DOMException && e.name === 'AbortError')) {
				this.error = e instanceof Error ? e.message : String(e);
			}
		}
	}

	pause() {
		this.#adapter?.pause();
	}

	toggle() {
		if (this.playing) this.pause();
		else void this.play();
	}

	seek(time: number) {
		this.#adapter?.seek(time);
		this.time = time;
	}

	setRate(rate: number) {
		this.rate = clampRate(rate);
		this.#adapter?.setRate(this.rate);
		try {
			globalThis.localStorage?.setItem(RATE_KEY, String(this.rate));
		} catch {
			// Only a preference.
		}
	}

	setLoop(loop: boolean) {
		this.loop = loop;
		this.#adapter?.setLoop(loop);
	}

	/** Keeps the bounds in step with the clip after an edit (unless a preview overrides them). */
	syncClip(clip: Pick<Clip, 'start' | 'end'> | undefined) {
		if (!clip) {
			this.close();
			return;
		}
		if (this.previewing) return;
		if (clip.start === this.trim.start && clip.end === this.trim.end) return;
		this.trim = { start: clip.start, end: clip.end };
		this.#adapter?.setBounds(clip.start, clip.end);
	}

	/** Plays the current clip between other bounds, looped: the trim editor's preview. */
	async preview(start: number | undefined, end: number | undefined) {
		this.previewing = true;
		this.trim = { start, end };
		this.#adapter?.setBounds(start, end);
		this.#adapter?.setLoop(true);
		this.#adapter?.seek(start ?? 0);
		await this.play();
	}

	/** Back to the clip's own bounds and loop setting. */
	endPreview() {
		if (!this.previewing) return;
		this.previewing = false;
		this.#adapter?.setLoop(this.loop);
		const current = this.current && this.#lookup(this.current.pieceId, this.current.clipId);
		this.syncClip(current?.clip);
	}

	#revoke() {
		if (this.#objectUrl) URL.revokeObjectURL(this.#objectUrl);
		this.#objectUrl = undefined;
	}

	#teardown() {
		this.#off?.();
		this.#off = undefined;
		this.#adapter?.destroy();
		this.#adapter = undefined;
		this.#revoke();
	}

	close() {
		this.#loadToken++;
		this.#teardown();
		this.current = undefined;
		this.kind = undefined;
		this.playing = false;
		this.loading = false;
		this.error = undefined;
		this.previewing = false;
		this.time = 0;
		this.duration = undefined;
	}
}

export const player = new PlayerStore();
