// The integration cache (PLAN.md §2): third-party data kept on this device only, never synced, and
// safe to drop at any time. Reads are stale-while-revalidate: anything cached is returned at once,
// and a stale entry is refreshed in the background when we're online.

/** Bump to ignore entries written by an older shape of the parsed data. */
export const CACHE_VERSION = 1;

export interface CacheEntry<T = unknown> {
	v: number;
	/** When it was fetched, epoch ms. */
	at: number;
	data: T;
}

/** A minimal async key-value store: IndexedDB in the browser, a Map in tests. */
export interface KeyValueStore {
	get(key: string): Promise<unknown>;
	set(key: string, value: unknown): Promise<void>;
	delete(key: string): Promise<void>;
	clear(): Promise<void>;
	keys(): Promise<string[]>;
}

export function memoryStore(): KeyValueStore & { map: Map<string, unknown> } {
	const map = new Map<string, unknown>();
	return {
		map,
		get: async (key) => structuredClone(map.get(key)),
		set: async (key, value) => void map.set(key, structuredClone(value)),
		delete: async (key) => void map.delete(key),
		clear: async () => map.clear(),
		keys: async () => [...map.keys()]
	};
}

/** A one-object-store IndexedDB database. Opened lazily; each call is its own transaction. */
export function indexedDbStore(dbName: string, storeName = 'entries'): KeyValueStore {
	let db: Promise<IDBDatabase> | undefined;
	const open = () =>
		(db ??= new Promise((resolve, reject) => {
			const req = indexedDB.open(dbName, 1);
			req.onupgradeneeded = () => req.result.createObjectStore(storeName);
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		}));
	const run = async <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) => {
		const store = (await open()).transaction(storeName, mode).objectStore(storeName);
		return new Promise<T>((resolve, reject) => {
			const req = fn(store);
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		});
	};
	return {
		get: (key) => run('readonly', (s) => s.get(key)),
		set: async (key, value) => void (await run('readwrite', (s) => s.put(value, key))),
		delete: async (key) => void (await run('readwrite', (s) => s.delete(key))),
		clear: async () => void (await run('readwrite', (s) => s.clear())),
		keys: async () => (await run('readonly', (s) => s.getAllKeys())).map(String)
	};
}

export interface SwrCacheOptions {
	now?: () => number;
	/** Whether to try the network at all. Defaults to navigator.onLine. */
	online?: () => boolean;
	onError?: (key: string, error: unknown) => void;
}

export interface GetOptions<T> {
	/** Called with fresh data after a background refresh of a stale entry. */
	onUpdate?: (data: T) => void;
}

export class SwrCache {
	#store: KeyValueStore;
	#now: () => number;
	#online: () => boolean;
	#onError: (key: string, error: unknown) => void;
	#inFlight = new Map<string, Promise<unknown>>();

	constructor(store: KeyValueStore, options: SwrCacheOptions = {}) {
		this.#store = store;
		this.#now = options.now ?? Date.now;
		this.#online = options.online ?? (() => globalThis.navigator?.onLine ?? true);
		this.#onError = options.onError ?? ((key, e) => console.warn(`Couldn’t refresh ${key}`, e));
	}

	/** The cached entry, if there is one of the current version. Never touches the network. */
	async peek<T>(key: string): Promise<CacheEntry<T> | undefined> {
		try {
			const entry = (await this.#store.get(key)) as CacheEntry<T> | undefined;
			return entry && entry.v === CACHE_VERSION ? entry : undefined;
		} catch (e) {
			// A broken or blocked IndexedDB just means no cache.
			console.warn(`Cache read failed for ${key}`, e);
			return undefined;
		}
	}

	/**
	 * Cached data if there is any, refreshing it in the background once older than `ttl`; otherwise
	 * fetches, stores and returns it. Concurrent requests for one key share a fetch.
	 */
	async get<T>(
		key: string,
		ttl: number,
		fetcher: () => Promise<T>,
		options: GetOptions<T> = {}
	): Promise<T> {
		const entry = await this.peek<T>(key);
		if (entry) {
			if (this.#now() - entry.at >= ttl && this.#online()) {
				this.#fetch(key, fetcher).then(
					(data) => options.onUpdate?.(data),
					(e) => this.#onError(key, e)
				);
			}
			return entry.data;
		}
		return this.#fetch(key, fetcher);
	}

	#fetch<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
		let pending = this.#inFlight.get(key) as Promise<T> | undefined;
		if (!pending) {
			pending = (async () => {
				try {
					const data = await fetcher();
					const entry: CacheEntry<T> = { v: CACHE_VERSION, at: this.#now(), data };
					await this.#store.set(key, entry).catch((e) => console.warn('Cache write failed', e));
					return data;
				} finally {
					this.#inFlight.delete(key);
				}
			})();
			this.#inFlight.set(key, pending);
		}
		return pending;
	}

	async keys(): Promise<string[]> {
		try {
			return await this.#store.keys();
		} catch {
			return [];
		}
	}

	clear(): Promise<void> {
		return this.#store.clear();
	}
}

/**
 * Wraps fetch so requests go out one at a time, at least `gapMs` apart: polite to a volunteer-run
 * site like thesession.org.
 */
export function throttledFetch(
	inner: typeof fetch,
	gapMs: number,
	now: () => number = Date.now,
	sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))
): typeof fetch {
	let queue: Promise<unknown> = Promise.resolve();
	let last = -Infinity;
	return (...args) => {
		const turn = queue.then(async () => {
			const wait = last + gapMs - now();
			if (wait > 0) await sleep(wait);
			last = now();
			return inner(...args);
		});
		// The next request waits for this one to finish, whether it failed or not.
		queue = turn.catch(() => {});
		return turn;
	};
}
