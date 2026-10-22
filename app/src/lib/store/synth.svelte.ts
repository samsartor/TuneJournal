// Synthesized playback of thesession settings for the UI and the player (PLAN.md §6.6, §14
// "Synthesized playback"): the device-local options, whether a thesession link can play here,
// and renderings, kept in the audio cache (OPFS) by setting, options and tempo.

import { asset } from '$app/paths';
import { audioCache } from '#lib/audio/cache.ts';
import { preloadSynth, renderTune } from '#lib/audio/synth.ts';
import { clipPlayback, type Playback, type SynthAvailability } from '#lib/domain/providers.ts';
import {
	DEFAULT_SYNTH_OPTIONS,
	buildTuneAbc,
	isSynthCacheKey,
	normalizeSynthOptions,
	renderRequest,
	synthCacheFamily,
	synthCacheKey,
	synthTarget,
	type SettingAbc,
	type SynthOptions,
	type SynthTarget
} from '#lib/domain/synth.ts';
import type { Piece, Source } from '#lib/domain/types.ts';
import { audioFiles } from './audio.svelte.ts';
import { loadErrorMessage, theSession } from './thesession.svelte.ts';

const OPTIONS_KEY = 'tunejournal.synth';

/** The self-hosted soundfont's folder (asset() only takes files, so go through its README). */
const SOUNDFONT_URL = asset('soundfont/README.txt').replace(/README\.txt$/, '');

/** Renderings kept per tune and options (other speeds); older ones are dropped. */
const KEEP_PER_TUNE = 3;
/** Renderings kept in all. Each is a few MB, and any can be rendered again. */
const KEEP_TOTAL = 24;

function readOptions(): SynthOptions {
	try {
		const stored = globalThis.localStorage?.getItem(OPTIONS_KEY);
		return normalizeSynthOptions(stored ? JSON.parse(stored) : undefined);
	} catch {
		return { ...DEFAULT_SYNTH_OPTIONS };
	}
}

class SynthStore {
	options = $state<SynthOptions>(readOptions());
	online = $state(globalThis.navigator?.onLine ?? true);

	#listeners = new Set<() => void>();
	#inFlight = new Map<string, Promise<Blob>>();

	constructor() {
		if (typeof addEventListener === 'function') {
			addEventListener('online', () => (this.online = true));
			addEventListener('offline', () => (this.online = false));
		}
	}

	setOptions(patch: Partial<SynthOptions>) {
		this.options = normalizeSynthOptions({ ...this.options, ...patch });
		try {
			globalThis.localStorage?.setItem(OPTIONS_KEY, JSON.stringify(this.options));
		} catch {
			// Only a preference.
		}
		for (const listener of this.#listeners) listener();
	}

	/** Called after the options change (the player re-renders what's loaded). */
	onOptionsChange(listener: () => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	/**
	 * Whether a recording can be synthesized here: it's the piece's link to a tune with a chosen
	 * setting, and the tune's ABC is cached on this device or we're online to fetch it.
	 */
	availability(piece: Pick<Piece, 'external'>, source: Source): SynthAvailability | undefined {
		const target = synthTarget(piece, source);
		if (!target) return undefined;
		theSession.prime([target.tuneId]);
		const cached = theSession.tunes.get(target.tuneId);
		const available = this.online || !!cached?.settings.some((s) => s.id === target.settingId);
		return { settingId: target.settingId, available };
	}

	/** How a recording plays, synthesized thesession settings included (see `clipPlayback`). */
	playback(piece: Pick<Piece, 'external'>, source: Source): Playback {
		const kind = clipPlayback(source, this.availability(piece, source));
		if (kind === 'synth') preloadSynth();
		return kind;
	}

	/** A recording plays in the app, as a real recording or a synthesized setting. */
	playable(piece: Pick<Piece, 'external'>, source: Source): boolean {
		return this.playback(piece, source) !== 'link';
	}

	/** The setting's ABC with what's needed to make a whole tune of it (cache first). */
	async setting(target: SynthTarget): Promise<SettingAbc> {
		let tune;
		try {
			tune = await theSession.fetchTune(target.tuneId);
		} catch (e) {
			throw new Error(loadErrorMessage(e), { cause: e });
		}
		const setting = tune.settings.find((s) => s.id === target.settingId);
		if (!setting) throw new Error('thesession.org doesn’t have this setting any more.');
		return { abc: setting.abc, key: setting.key, type: tune.type, title: tune.name };
	}

	/**
	 * A rendering of the setting at `rate` × its 100% tempo: from the audio cache, else rendered
	 * (and cached). Concurrent asks for the same rendering share one.
	 */
	async render(target: SynthTarget, rate = 1, transpose = 0): Promise<Blob> {
		const tune = buildTuneAbc(await this.setting(target), this.options.timesThrough);
		const request = renderRequest(tune, this.options, rate, transpose);
		const key = synthCacheKey(target.settingId, request);
		let pending = this.#inFlight.get(key);
		if (!pending) {
			pending = (async () => {
				const cached = await audioCache.get(key).catch(() => undefined);
				if (cached) return cached;
				const { blob } = await renderTune(request, SOUNDFONT_URL);
				try {
					await audioFiles.put(key, blob);
					await this.#prune(synthCacheFamily(target.settingId, request), key);
				} catch (e) {
					console.warn('Couldn’t cache the rendering', e);
				}
				return blob;
			})().finally(() => this.#inFlight.delete(key));
			this.#inFlight.set(key, pending);
		}
		return pending;
	}

	/** Keeps the newest renderings: a few per tune and options, and a cap overall. */
	async #prune(family: string, keep: string) {
		const synths = (await audioCache.entries())
			.filter((e) => isSynthCacheKey(e.id) && e.backend && !e.keep && e.id !== keep)
			.sort((a, b) => b.storedAt - a.storedAt);
		const sameTune = synths.filter((e) => e.id.startsWith(`${family}@`));
		const drop = new Set([
			...sameTune.slice(KEEP_PER_TUNE - 1).map((e) => e.id),
			...synths.slice(KEEP_TOTAL - 1).map((e) => e.id)
		]);
		for (const id of drop) await audioFiles.remove(id);
	}
}

export const synth = new SynthStore();
