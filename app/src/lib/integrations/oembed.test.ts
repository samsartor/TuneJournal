import { describe, expect, it, vi } from 'vitest';
import { SwrCache, memoryStore } from './cache';
import { cachedOEmbed, fetchOEmbed, oembedEndpoints, oembedKey } from './oembed';

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const URL_YT = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

describe('oEmbed', () => {
	it('builds endpoints per provider', () => {
		expect(oembedEndpoints('youtube', URL_YT)).toEqual([
			`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(URL_YT)}`,
			`https://noembed.com/embed?url=${encodeURIComponent(URL_YT)}`
		]);
		expect(oembedEndpoints('spotify', 'https://open.spotify.com/track/x')[0]).toMatch(
			/^https:\/\/open\.spotify\.com\/oembed\?url=/
		);
		expect(oembedEndpoints('url', 'https://e.com')).toEqual([]);
	});

	it('reads title, author and thumbnail', async () => {
		const fetcher = vi.fn(async () =>
			json({ title: ' Tune ', author_name: 'Band', thumbnail_url: 'https://i.ytimg.com/x.jpg' })
		);
		await expect(fetchOEmbed('youtube', URL_YT, fetcher)).resolves.toEqual({
			title: 'Tune',
			authorName: 'Band',
			thumbnailUrl: 'https://i.ytimg.com/x.jpg',
			via: 'www.youtube.com'
		});
		expect(fetcher).toHaveBeenCalledTimes(1);
	});

	it('falls back to noembed when YouTube fails, and skips noembed errors', async () => {
		const fetcher = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(json({}, 401))
			.mockResolvedValueOnce(json({ title: 'From noembed' }));
		await expect(fetchOEmbed('youtube', URL_YT, fetcher)).resolves.toMatchObject({
			title: 'From noembed',
			via: 'noembed.com'
		});

		const failing = vi
			.fn<typeof fetch>()
			.mockRejectedValueOnce(new TypeError('Failed to fetch'))
			.mockResolvedValueOnce(json({ error: 'no matching providers found' }));
		await expect(fetchOEmbed('youtube', URL_YT, failing)).rejects.toThrow(/no matching/);
	});

	it('has nothing to fetch for a plain link', async () => {
		await expect(fetchOEmbed('url', 'https://e.com', vi.fn())).rejects.toThrow(/No oEmbed/);
	});

	it('caches results', async () => {
		const store = memoryStore();
		const cache = new SwrCache(store, { now: () => 0, online: () => true });
		const fetcher = vi.fn(async () => json({ title: 'Cached' }));
		const a = await cachedOEmbed(cache, 'spotify', 'track:1', 'https://open.spotify.com/track/1', {
			fetcher
		});
		const b = await cachedOEmbed(cache, 'spotify', 'track:1', 'https://open.spotify.com/track/1', {
			fetcher
		});
		expect(a).toEqual(b);
		expect(fetcher).toHaveBeenCalledTimes(1);
		expect([...store.map.keys()]).toEqual([oembedKey('spotify', 'track:1')]);
	});
});
