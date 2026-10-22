// thesession.org through the integration cache: what the UI calls. TTLs are long for tune data,
// which rarely changes, and short for searches.

import type { GetOptions, SwrCache } from './cache.ts';
import type {
	SearchResults,
	TheSessionClient,
	Tune,
	TuneRecordings,
	TuneSets
} from './thesession.ts';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export const TTL = {
	tune: 7 * DAY,
	sets: 7 * DAY,
	recordings: 7 * DAY,
	search: HOUR
} as const;

export const cacheKey = {
	tune: (id: number) => `thesession:tune:${id}`,
	sets: (id: number, page = 1) => `thesession:sets:${id}:${page}`,
	recordings: (id: number) => `thesession:recordings:${id}`,
	search: (q: string) => `thesession:search:${normalizeQuery(q)}`
};

export function normalizeQuery(q: string): string {
	return q.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

export class CachedTheSession {
	constructor(
		readonly client: TheSessionClient,
		readonly cache: SwrCache
	) {}

	tune(id: number, options?: GetOptions<Tune>): Promise<Tune> {
		return this.cache.get(cacheKey.tune(id), TTL.tune, () => this.client.tune(id), options);
	}

	/** The cached tune only, without going to the network. */
	async cachedTune(id: number): Promise<Tune | undefined> {
		return (await this.cache.peek<Tune>(cacheKey.tune(id)))?.data;
	}

	sets(id: number, page = 1, options?: GetOptions<TuneSets>): Promise<TuneSets> {
		return this.cache.get(
			cacheKey.sets(id, page),
			TTL.sets,
			() => this.client.tuneSets(id, page === 1 ? undefined : page),
			options
		);
	}

	recordings(id: number, options?: GetOptions<TuneRecordings>): Promise<TuneRecordings> {
		return this.cache.get(
			cacheKey.recordings(id),
			TTL.recordings,
			() => this.client.tuneRecordings(id),
			options
		);
	}

	search(q: string, options?: GetOptions<SearchResults>): Promise<SearchResults> {
		const query = normalizeQuery(q);
		return this.cache.get(
			cacheKey.search(query),
			TTL.search,
			() => this.client.search(query, { perpage: 20 }),
			options
		);
	}
}
