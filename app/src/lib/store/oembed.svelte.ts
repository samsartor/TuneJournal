// oEmbed titles and thumbnails for YouTube and Spotify clips, from the integration cache (shared
// with thesession, so "Clear cached data" drops these too). Never written to the synced doc.

import { SvelteMap } from 'svelte/reactivity';
import type { Provider, Source } from '#lib/domain/types.ts';
import { SwrCache, indexedDbStore } from '#lib/integrations/cache.ts';
import { cachedOEmbed, oembedEndpoints, type OEmbed } from '#lib/integrations/oembed.ts';

class OEmbedStore {
	/** Loaded data by `${provider}:${id}`. */
	readonly data = new SvelteMap<string, OEmbed>();
	#cache?: SwrCache;
	#requested = new Set<string>();

	get cache(): SwrCache {
		this.#cache ??= new SwrCache(indexedDbStore('tunejournal-cache'));
		return this.#cache;
	}

	has(provider: Provider): boolean {
		return oembedEndpoints(provider, 'x').length > 0;
	}

	/** Fetches (or reads the cache) directly, e.g. for the paste preview. */
	fetch(provider: Provider, key: string, url: string): Promise<OEmbed> {
		return cachedOEmbed(this.cache, provider, key, url);
	}

	/**
	 * A source's oEmbed data once it's loaded. Safe to call while rendering: the first call starts
	 * loading it (cache first) outside the reactive context, and the result appears in `data`.
	 */
	lookup(source: Pick<Source, 'provider' | 'url' | 'externalId'>): OEmbed | undefined {
		if (!this.has(source.provider)) return undefined;
		const key = source.externalId ?? source.url;
		const id = `${source.provider}:${key}`;
		if (!this.#requested.has(id)) {
			this.#requested.add(id);
			queueMicrotask(() => {
				cachedOEmbed(this.cache, source.provider, key, source.url, {
					onUpdate: (fresh) => this.data.set(id, fresh)
				}).then(
					(found) => this.data.set(id, found),
					// Offline or unknown: show the provider's name instead, and try again next time.
					() => this.#requested.delete(id)
				);
			});
		}
		return this.data.get(id);
	}

	/** Forget loaded data after the cache was cleared. */
	reset() {
		this.data.clear();
		this.#requested.clear();
	}
}

export const oembed = new OEmbedStore();
