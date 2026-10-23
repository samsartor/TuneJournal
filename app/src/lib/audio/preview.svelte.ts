// Previews in the thesession.org pickers (PLAN.md §6.3): a tune's or setting's synthesized
// rendering, played on its own <audio> through a SynthAdapter, so it never touches the library,
// the clips or the global player's queue. One preview at a time. Starting one pauses the main
// player; the picker stops it when it closes. Renderings go through the synth store, so they land
// in the audio cache and a setting heard here plays at once once chosen.
//
// The picker's preview bar pauses, resumes and seeks it; times are tune seconds at 100%, as for the
// main player (audio/synth-adapter.ts), so a place in the tune holds across speed changes. A map of
// the tune's bars (ui/follow.ts) lets the playing setting's notation follow along.

import { buildTuneAbc, secondsPerWhole, type SynthTarget } from '#lib/domain/synth.ts';
import { synth } from '#lib/store/synth.svelte.ts';
import { scoreMap, type ScoreMap } from '#lib/ui/follow.ts';
import { clampRate, clampTime } from './bounds.ts';
import { player } from './player.svelte.ts';
import { abcjsLibrary } from './synth.ts';
import { SynthAdapter } from './synth-adapter.ts';

export type PreviewState = 'idle' | 'loading' | 'playing' | 'paused';

class PreviewStore {
	/** What's loaded: a caller's key such as `setting:12342` or `tune:1`. */
	key = $state<string>();
	/** What the preview bar calls it: "Setting 2", or a tune's name. */
	title = $state('');
	loading = $state(false);
	playing = $state(false);
	/** Tune seconds at 100% (the adapter's time), and the whole rendering's length. */
	time = $state(0);
	duration = $state(0);
	/** The loaded tune's bars, for notation that follows it; unset until mapped. */
	score = $state.raw<ScoreMap>();
	/** Why the last preview couldn't play, for the row it belongs to. */
	error = $state<{ key: string; message: string }>();
	/** The preview's own speed (× the tune type's default tempo), kept while the app is open. */
	rate = $state(1);

	#adapter?: SynthAdapter;
	#off?: () => void;
	#token = 0;

	state(key: string): PreviewState {
		if (this.key !== key) return 'idle';
		if (this.loading) return 'loading';
		if (!this.#adapter) return 'idle';
		return this.playing ? 'playing' : 'paused';
	}

	/** Plays `key`, resumes it if it's paused, or stops it if it's playing (or loading). */
	toggle(key: string, target: () => Promise<SynthTarget>, title = ''): Promise<void> {
		const state = this.state(key);
		if (state === 'paused') return this.resume();
		if (state !== 'idle') {
			this.stop();
			return Promise.resolve();
		}
		return this.play(key, target, title);
	}

	async play(key: string, target: () => Promise<SynthTarget>, title = ''): Promise<void> {
		this.stop();
		const token = ++this.#token;
		this.key = key;
		this.title = title;
		this.loading = true;
		this.error = undefined;
		player.pause();
		try {
			const t = await target();
			if (token !== this.#token) return;
			void this.#mapScore(t, token);
			const adapter = new SynthAdapter((tempo, transpose) => synth.render(t, tempo, transpose));
			this.#adapter = adapter;
			this.#off = adapter.onTime((s) => {
				if (token !== this.#token) return;
				this.playing = s.playing;
				this.time = s.time;
				if (s.duration !== undefined) this.duration = s.duration;
			});
			adapter.setRate(this.rate);
			await adapter.load({ kind: 'synth', url: '' });
			if (token !== this.#token) return;
			this.loading = false;
			// The main player may have been started while this rendered.
			player.pause();
			await adapter.play();
		} catch (e) {
			if (token !== this.#token) return;
			console.warn('Couldn’t preview', e);
			this.#teardown();
			this.loading = false;
			this.playing = false;
			this.score = undefined;
			this.error = { key, message: e instanceof Error ? e.message : String(e) };
		}
	}

	/** The tune's bars, mapped from the same ABC the synthesizer renders. */
	async #mapScore(target: SynthTarget, token: number) {
		try {
			const [setting, abcjs] = await Promise.all([synth.setting(target), abcjsLibrary()]);
			if (token !== this.#token) return;
			const tune = buildTuneAbc(setting, synth.options.timesThrough);
			this.score = scoreMap(abcjs, tune.abc, secondsPerWhole(tune.tempo));
		} catch (e) {
			// The preview still plays; its notation just stays put.
			console.warn('Couldn’t map the tune for following', e);
		}
	}

	pause() {
		this.#adapter?.pause();
	}

	async resume(): Promise<void> {
		if (!this.#adapter || this.loading) return;
		player.pause();
		try {
			await this.#adapter.play();
		} catch (e) {
			console.warn('Couldn’t resume the preview', e);
		}
	}

	togglePause(): Promise<void> {
		if (this.playing) {
			this.pause();
			return Promise.resolve();
		}
		return this.resume();
	}

	/** Seconds into the tune at 100%. */
	seek(time: number) {
		if (!this.#adapter || this.loading) return;
		const t = clampTime(time, { start: 0, end: this.duration || Infinity });
		this.#adapter.seek(t);
		this.time = t;
	}

	/** The time right now, between the audio's few updates a second (for smooth highlighting). */
	position(): number {
		const adapter = this.#adapter;
		if (!adapter || adapter.rerendering) return this.time;
		return adapter.inner.audio.currentTime * adapter.tempo;
	}

	stop() {
		this.#token++;
		this.#teardown();
		this.key = undefined;
		this.title = '';
		this.loading = false;
		this.playing = false;
		this.error = undefined;
		this.time = 0;
		this.duration = 0;
		this.score = undefined;
	}

	setRate(rate: number) {
		this.rate = clampRate(rate);
		this.#adapter?.setRate(this.rate);
	}

	#teardown() {
		this.#off?.();
		this.#off = undefined;
		this.#adapter?.destroy();
		this.#adapter = undefined;
	}
}

export const preview = new PreviewStore();
