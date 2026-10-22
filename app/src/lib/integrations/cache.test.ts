import { describe, expect, it, vi } from 'vitest';
import tune from './fixtures/tune-1.json';
import { CACHE_VERSION, SwrCache, memoryStore, throttledFetch } from './cache';
import { TheSessionClient } from './thesession';
import { CachedTheSession, TTL, cacheKey } from './thesession-cache';

function setup(online = true) {
	const store = memoryStore();
	let now = 1_000_000;
	const errors: unknown[] = [];
	const cache = new SwrCache(store, {
		now: () => now,
		online: () => online,
		onError: (_, e) => errors.push(e)
	});
	return {
		store,
		cache,
		errors,
		advance: (ms: number) => (now += ms),
		setOnline: (v: boolean) => (online = v)
	};
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('SwrCache', () => {
	it('fetches once, then serves from the cache while fresh', async () => {
		const { cache, store } = setup();
		const fetcher = vi.fn(async () => ({ n: 1 }));
		expect(await cache.get('k', 100, fetcher)).toEqual({ n: 1 });
		expect(await cache.get('k', 100, fetcher)).toEqual({ n: 1 });
		expect(fetcher).toHaveBeenCalledTimes(1);
		expect(store.map.get('k')).toEqual({ v: CACHE_VERSION, at: 1_000_000, data: { n: 1 } });
	});

	it('returns stale data at once and refreshes it in the background', async () => {
		const { cache, advance } = setup();
		let n = 0;
		const fetcher = async () => ({ n: ++n });
		await cache.get('k', 100, fetcher);
		advance(100);
		const onUpdate = vi.fn();
		expect(await cache.get('k', 100, fetcher, { onUpdate })).toEqual({ n: 1 });
		await flush();
		expect(onUpdate).toHaveBeenCalledWith({ n: 2 });
		expect(await cache.get('k', 100, fetcher)).toEqual({ n: 2 });
	});

	it('serves stale data offline without trying the network', async () => {
		const { cache, advance, setOnline } = setup();
		await cache.get('k', 100, async () => 'cached');
		setOnline(false);
		advance(10_000);
		const fetcher = vi.fn(async () => 'new');
		expect(await cache.get('k', 100, fetcher)).toBe('cached');
		expect(fetcher).not.toHaveBeenCalled();
	});

	it('keeps stale data when the refresh fails, and rejects when nothing is cached', async () => {
		const { cache, advance, errors } = setup();
		await cache.get('k', 100, async () => 'cached');
		advance(100);
		const fail = async () => {
			throw new Error('down');
		};
		expect(await cache.get('k', 100, fail)).toBe('cached');
		await flush();
		expect(errors).toHaveLength(1);
		expect(await cache.peek('k')).toMatchObject({ data: 'cached' });
		await expect(cache.get('other', 100, fail)).rejects.toThrow('down');
	});

	it('shares one fetch between concurrent requests', async () => {
		const { cache } = setup();
		const fetcher = vi.fn(async () => 'x');
		await Promise.all([cache.get('k', 1, fetcher), cache.get('k', 1, fetcher)]);
		expect(fetcher).toHaveBeenCalledTimes(1);
	});

	it('ignores entries from another cache version, and clears', async () => {
		const { cache, store } = setup();
		store.map.set('old', { v: CACHE_VERSION - 1, at: 0, data: 'x' });
		expect(await cache.peek('old')).toBeUndefined();
		await cache.get('k', 1, async () => 'y');
		expect(await cache.keys()).toEqual(['old', 'k']);
		await cache.clear();
		expect(await cache.keys()).toEqual([]);
	});
});

describe('throttledFetch', () => {
	it('sends requests one at a time, spaced out', async () => {
		let now = 0;
		const sleeps: number[] = [];
		const sent: number[] = [];
		const inner = vi.fn(async () => {
			sent.push(now);
			return new Response('ok');
		});
		const throttled = throttledFetch(
			inner as typeof fetch,
			250,
			() => now,
			async (ms) => {
				sleeps.push(ms);
				now += ms;
			}
		);
		await Promise.all([throttled('a'), throttled('b'), throttled('c')]);
		expect(sent).toEqual([0, 250, 500]);
		expect(sleeps).toEqual([250, 250]);
	});

	it('keeps going after a failed request', async () => {
		let calls = 0;
		const inner = async () => {
			if (calls++ === 0) throw new Error('boom');
			return new Response('ok');
		};
		const throttled = throttledFetch(inner as typeof fetch, 0);
		await expect(throttled('a')).rejects.toThrow('boom');
		expect((await throttled('b')).ok).toBe(true);
	});
});

describe('CachedTheSession', () => {
	it('caches parsed tunes and serves them offline', async () => {
		const { cache, setOnline } = setup();
		const fetch = vi.fn(async () => new Response(JSON.stringify(tune)));
		const ts = new CachedTheSession(new TheSessionClient({ fetch }), cache);
		expect(await ts.cachedTune(1)).toBeUndefined();
		const first = await ts.tune(1);
		expect(first.aliases).toContain('The Tulla');
		setOnline(false);
		expect((await ts.tune(1)).name).toBe("Cooley's");
		expect((await ts.cachedTune(1))?.id).toBe(1);
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(await cache.keys()).toEqual([cacheKey.tune(1)]);
		expect(TTL.search).toBeLessThan(TTL.tune);
	});

	it('normalizes search queries into one cache key', async () => {
		const { cache } = setup();
		const fetch = vi.fn(
			async () => new Response(JSON.stringify({ page: 1, pages: 1, total: 0, tunes: [] }))
		);
		const ts = new CachedTheSession(new TheSessionClient({ fetch }), cache);
		await ts.search('Cooley ');
		await ts.search('  cooley');
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(await cache.keys()).toEqual([cacheKey.search('cooley')]);
	});
});
