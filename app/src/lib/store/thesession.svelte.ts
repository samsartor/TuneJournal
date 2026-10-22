// Reactive access to thesession.org data through the integration cache (PLAN.md §2). Nothing here
// is synced: it's per-device, rebuilt on demand, and dropped by "Clear cached data".

import { SvelteMap } from 'svelte/reactivity';
import type { LibraryIndex } from '#lib/domain/derived.ts';
import type { PieceId } from '#lib/domain/types.ts';
import { SwrCache, indexedDbStore, throttledFetch } from '#lib/integrations/cache.ts';
import { CachedTheSession } from '#lib/integrations/thesession-cache.ts';
import {
	TheSessionClient,
	TheSessionError,
	dedupeSearch,
	dedupeSets,
	dedupeTune,
	type SearchResults,
	type Tune,
	type TuneSets
} from '#lib/integrations/thesession.ts';

/** Gap between requests to thesession.org. */
const REQUEST_GAP_MS = 300;

/** Async data with its loading state, shared by every component that asks for the same key. */
export class Resource<T> {
	data = $state.raw<T>();
	error = $state.raw<unknown>();
	loading = $state(true);

	constructor(readonly load: (onUpdate: (data: T) => void) => Promise<T>) {
		queueMicrotask(() => this.refresh());
	}

	async refresh() {
		this.loading = true;
		try {
			this.data = await this.load((data) => (this.data = data));
			this.error = undefined;
		} catch (e) {
			this.error = e;
		} finally {
			this.loading = false;
		}
	}
}

/** Why something couldn't be loaded, for display. */
export function loadErrorMessage(e: unknown): string {
	if (globalThis.navigator && !navigator.onLine) {
		return 'You’re offline, and this hasn’t been saved on this device yet.';
	}
	if (e instanceof TheSessionError && e.status === 404) {
		return 'thesession.org doesn’t have this any more.';
	}
	return 'Couldn’t reach thesession.org. Try again in a moment.';
}

class TheSessionStore {
	/** Tunes loaded so far (from the cache or the network), for alias search. */
	readonly tunes = new SvelteMap<number, Tune>();

	#api?: CachedTheSession;
	#resources = new Map<string, Resource<unknown>>();
	#primed = new Set<number>();
	#listening = false;

	get api(): CachedTheSession {
		if (!this.#api) {
			const client = new TheSessionClient({
				fetch: throttledFetch((...args) => fetch(...args), REQUEST_GAP_MS)
			});
			this.#api = new CachedTheSession(client, new SwrCache(indexedDbStore('tunejournal-cache')));
		}
		return this.#api;
	}

	#resource<T>(key: string, load: (onUpdate: (data: T) => void) => Promise<T>): Resource<T> {
		let resource = this.#resources.get(key) as Resource<T> | undefined;
		if (!resource) {
			resource = new Resource(load);
			this.#resources.set(key, resource as Resource<unknown>);
			this.#retryWhenOnline();
		}
		return resource;
	}

	/** Retries everything that failed once the browser is back online. */
	#retryWhenOnline() {
		if (this.#listening || typeof addEventListener === 'undefined') return;
		this.#listening = true;
		addEventListener('online', () => {
			for (const r of this.#resources.values()) if (r.error) r.refresh();
		});
	}

	#keep = (cached: Tune) => {
		// Data cached by an older version may still hold repeats; the UI keys lists by id.
		const tune = dedupeTune(cached);
		this.tunes.set(tune.id, tune);
		this.#primed.add(tune.id);
		return tune;
	};

	/** A tune's details (aliases, settings, counts), cached. */
	tune(id: number): Resource<Tune> {
		return this.#resource(`tune:${id}`, async (onUpdate) =>
			this.#keep(await this.api.tune(id, { onUpdate: (t) => onUpdate(this.#keep(t)) }))
		);
	}

	/** The first page of sets the tune appears in (10 per page). */
	sets(id: number): Resource<TuneSets> {
		return this.#resource(`sets:${id}`, async (onUpdate) =>
			dedupeSets(await this.api.sets(id, 1, { onUpdate: (s) => onUpdate(dedupeSets(s)) }))
		);
	}

	/** Fetches (or reads the cached) tune directly, for the autofill flow. */
	async fetchTune(id: number): Promise<Tune> {
		const tune = this.#keep(await this.api.tune(id));
		return tune;
	}

	async search(q: string, onUpdate?: (r: SearchResults) => void): Promise<SearchResults> {
		return dedupeSearch(
			await this.api.search(q, { onUpdate: onUpdate && ((r) => onUpdate(dedupeSearch(r))) })
		);
	}

	/** Loads cached tunes for these ids into `tunes`, without touching the network. */
	prime(ids: Iterable<number>) {
		for (const id of ids) {
			if (this.#primed.has(id)) continue;
			this.#primed.add(id);
			this.api
				.cachedTune(id)
				.then((tune) => tune && this.tunes.set(id, dedupeTune(tune)))
				.catch(() => this.#primed.delete(id));
		}
	}

	/** Other names to search each live piece by: its thesession name and aliases. */
	aliasMap(index: LibraryIndex): Map<PieceId, string[]> {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- rebuilt on every call, not state
		const map = new Map<PieceId, string[]>();
		for (const piece of index.live) {
			const id = piece.external?.thesession?.tuneId;
			const tune = id === undefined ? undefined : this.tunes.get(id);
			if (tune) map.set(piece.id, [tune.name, ...tune.aliases]);
		}
		return map;
	}

	async entryCount(): Promise<number> {
		return (await this.api.cache.keys()).length;
	}

	/** Drops everything cached from thesession.org on this device. */
	async clear() {
		await this.api.cache.clear();
		this.tunes.clear();
		this.#resources.clear();
		this.#primed.clear();
	}
}

export const theSession = new TheSessionStore();
