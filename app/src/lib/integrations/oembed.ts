// Titles and thumbnails for pasted links, through oEmbed (PLAN.md §7). YouTube's own endpoint
// reflects our origin in CORS; noembed.com (ACAO: *) is the fallback. Spotify has its own endpoint
// with ACAO: *. Results go in the integration cache, never in the synced doc (§13).

import type { Provider } from '#lib/domain/types.ts';
import type { GetOptions, SwrCache } from './cache.ts';

export interface OEmbed {
	title?: string;
	authorName?: string;
	thumbnailUrl?: string;
	/** Which endpoint answered, e.g. "www.youtube.com". */
	via: string;
}

const DAY = 24 * 60 * 60 * 1000;
export const OEMBED_TTL = 30 * DAY;

export function oembedKey(provider: Provider, idOrUrl: string): string {
	return `oembed:${provider}:${idOrUrl}`;
}

/** The oEmbed endpoints to try for a link, in order. Empty if the provider has none. */
export function oembedEndpoints(provider: Provider, url: string): string[] {
	const q = encodeURIComponent(url);
	switch (provider) {
		case 'youtube':
			return [
				`https://www.youtube.com/oembed?format=json&url=${q}`,
				`https://noembed.com/embed?url=${q}`
			];
		case 'spotify':
			return [`https://open.spotify.com/oembed?url=${q}`];
		default:
			return [];
	}
}

interface RawOEmbed {
	title?: unknown;
	author_name?: unknown;
	thumbnail_url?: unknown;
	error?: unknown;
}

const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

export class OEmbedError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'OEmbedError';
	}
}

/** Fetches oEmbed data, trying each endpoint until one answers with a title. */
export async function fetchOEmbed(
	provider: Provider,
	url: string,
	fetcher: typeof fetch = fetch
): Promise<OEmbed> {
	const endpoints = oembedEndpoints(provider, url);
	let lastError: unknown = new OEmbedError(`No oEmbed endpoint for ${provider}`);
	for (const endpoint of endpoints) {
		try {
			const res = await fetcher(endpoint);
			if (!res.ok) throw new OEmbedError(`${res.status} from ${new URL(endpoint).host}`);
			const raw = (await res.json()) as RawOEmbed;
			// noembed answers 200 with { error } for unknown or private videos.
			if (raw.error || !text(raw.title)) {
				throw new OEmbedError(String(raw.error ?? 'No title'));
			}
			const result: OEmbed = { via: new URL(endpoint).host, title: text(raw.title) };
			const author = text(raw.author_name);
			const thumb = text(raw.thumbnail_url);
			if (author) result.authorName = author;
			if (thumb) result.thumbnailUrl = thumb;
			return result;
		} catch (e) {
			lastError = e;
		}
	}
	throw lastError;
}

/** oEmbed through the integration cache. */
export function cachedOEmbed(
	cache: SwrCache,
	provider: Provider,
	key: string,
	url: string,
	options?: GetOptions<OEmbed> & { fetcher?: typeof fetch }
): Promise<OEmbed> {
	return cache.get(
		oembedKey(provider, key),
		OEMBED_TTL,
		() => fetchOEmbed(provider, url, options?.fetcher),
		options
	);
}
