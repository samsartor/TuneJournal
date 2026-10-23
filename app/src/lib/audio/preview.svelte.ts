// Previews in the thesession.org pickers (PLAN.md §6.3): a tune's or setting's synthesized
// rendering, played on its own <audio> through a SynthAdapter, so it never touches the library,
// the clips or the global player's queue. One preview at a time. Starting one pauses the main
// player; the picker stops it when it closes. Renderings go through the synth store, so they land
// in the audio cache and a setting heard here plays at once once chosen.

import type { SynthTarget } from '#lib/domain/synth.ts';
import { synth } from '#lib/store/synth.svelte.ts';
import { clampRate } from './bounds.ts';
import { player } from './player.svelte.ts';
import { SynthAdapter } from './synth-adapter.ts';

export type PreviewState = 'idle' | 'loading' | 'playing';

class PreviewStore {
	/** What's loaded: a caller's key such as `setting:12342` or `tune:1`. */
	key = $state<string>();
	loading = $state(false);
	playing = $state(false);
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
		return this.playing ? 'playing' : 'idle';
	}

	/** Plays `key`, or stops it if it's the one playing (or loading). */
	toggle(key: string, target: () => Promise<SynthTarget>): Promise<void> {
		if (this.state(key) !== 'idle') {
			this.stop();
			return Promise.resolve();
		}
		return this.play(key, target);
	}

	async play(key: string, target: () => Promise<SynthTarget>): Promise<void> {
		this.stop();
		const token = ++this.#token;
		this.key = key;
		this.loading = true;
		this.error = undefined;
		player.pause();
		try {
			const t = await target();
			if (token !== this.#token) return;
			const adapter = new SynthAdapter((tempo, transpose) => synth.render(t, tempo, transpose));
			this.#adapter = adapter;
			this.#off = adapter.onTime((s) => {
				if (token === this.#token) this.playing = s.playing;
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
			this.error = { key, message: e instanceof Error ? e.message : String(e) };
		}
	}

	stop() {
		this.#token++;
		this.#teardown();
		this.key = undefined;
		this.loading = false;
		this.playing = false;
		this.error = undefined;
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
