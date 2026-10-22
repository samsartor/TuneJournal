// Typed client for the thesession.org JSON API (https://thesession.org/api).
// Every `?format=json` endpoint sends `Access-Control-Allow-Origin: *`, so this runs in the browser.
// Responses are parsed into our own camelCase shapes so the rest of the app never sees raw JSON.

export const THESESSION_ORIGIN = 'https://thesession.org';

export interface MemberRef {
	id: number;
	/** null in search results. */
	name: string | null;
	url: string;
}

export interface Page {
	page: number;
	pages: number;
	total: number;
}

export interface TuneSummary {
	id: number;
	name: string;
	url: string;
	/** Lowercase, e.g. "reel", "jig", "slip jig", "hornpipe", "polka". */
	type: string;
	date: string;
}

export interface SearchHit extends TuneSummary {
	/** The alias the query matched, when it matched one rather than the name. */
	alias?: string;
}

export interface SearchResults extends Page {
	tunes: SearchHit[];
}

export interface TuneSetting {
	id: number;
	url: string;
	/** Tonic + full mode name, e.g. "Edorian", "Dmajor", "F#minor". See parseKey. */
	key: string;
	/** Tune body only, no header. `!` marks a line break. */
	abc: string;
	member: MemberRef;
	date: string;
}

export interface Tune extends TuneSummary {
	aliases: string[];
	tunebooks: number;
	/** Count only; the list is at tuneRecordings(). */
	recordings: number;
	settings: TuneSetting[];
	member: MemberRef;
}

export interface SetEntry {
	/** The setting id; the tune id is parsed out of the URL. */
	settingId: number;
	tuneId: number;
	name: string;
	url: string;
	type: string;
	meter: string;
	/** Abbreviated mode here, e.g. "Edor", "Gmaj". See parseKey. */
	key: string;
}

export interface TuneSet {
	id: number;
	name: string;
	url: string;
	date: string;
	member: MemberRef;
	tunes: SetEntry[];
}

export interface TuneSets extends Page {
	sets: TuneSet[];
}

export interface Recording {
	id: number;
	name: string;
	url: string;
	artist: { id: number; name: string; url: string };
}

export interface TuneRecordings {
	id: number;
	name: string;
	recordings: Recording[];
	/** Tunes that share a track with this one; `count` is how many tracks. */
	recordedWith: { id: number; name: string; count: number }[];
}

export class TheSessionError extends Error {
	constructor(
		message: string,
		readonly status?: number
	) {
		super(message);
		this.name = 'TheSessionError';
	}
}

// Minimal structural checks: enough to fail loudly if the API changes shape.

type Json = Record<string, unknown>;

function obj(v: unknown, what: string): Json {
	if (v === null || typeof v !== 'object' || Array.isArray(v)) {
		throw new TheSessionError(`Expected an object for ${what}`);
	}
	return v as Json;
}

function arr(v: unknown, what: string): unknown[] {
	if (!Array.isArray(v)) throw new TheSessionError(`Expected an array for ${what}`);
	return v;
}

function num(v: unknown, what: string): number {
	const n = typeof v === 'string' ? Number(v) : v;
	if (typeof n !== 'number' || !Number.isFinite(n)) {
		throw new TheSessionError(`Expected a number for ${what}`);
	}
	return n;
}

function str(v: unknown, what: string): string {
	if (typeof v !== 'string') throw new TheSessionError(`Expected a string for ${what}`);
	return v;
}

function member(v: unknown): MemberRef {
	const m = obj(v, 'member');
	return {
		id: num(m.id, 'member.id'),
		name: typeof m.name === 'string' ? m.name : null,
		url: str(m.url, 'member.url')
	};
}

function page(j: Json): Page {
	return {
		page: num(j.page, 'page'),
		pages: num(j.pages, 'pages'),
		total: num(j.total, 'total')
	};
}

function tuneSummary(v: unknown): TuneSummary {
	const t = obj(v, 'tune');
	return {
		id: num(t.id, 'tune.id'),
		name: str(t.name, 'tune.name'),
		url: str(t.url, 'tune.url'),
		type: str(t.type, 'tune.type'),
		date: str(t.date, 'tune.date')
	};
}

/**
 * Keeps the first item for each id. thesession.org's lists can repeat an entry: `/tunes/4428/sets`
 * lists set 150333 twice (once per time the tune appears in it), and the UI keys lists by id.
 */
export function uniqueById<T extends { id: number }>(items: readonly T[]): T[] {
	const seen = new Set<number>();
	return items.filter((item) => {
		if (seen.has(item.id)) return false;
		seen.add(item.id);
		return true;
	});
}

/** Drops repeated sets, also from data cached before parseSets deduped them. */
export function dedupeSets(sets: TuneSets): TuneSets {
	const unique = uniqueById(sets.sets);
	return unique.length === sets.sets.length ? sets : { ...sets, sets: unique };
}

/** Drops repeated hits, also from data cached before parseSearch deduped them. */
export function dedupeSearch(results: SearchResults): SearchResults {
	const unique = uniqueById(results.tunes);
	return unique.length === results.tunes.length ? results : { ...results, tunes: unique };
}

/** Drops repeated settings, also from data cached before parseTune deduped them. */
export function dedupeTune(tune: Tune): Tune {
	const unique = uniqueById(tune.settings);
	return unique.length === tune.settings.length ? tune : { ...tune, settings: unique };
}

export function parseSearch(json: unknown): SearchResults {
	const j = obj(json, 'search');
	return dedupeSearch({
		...page(j),
		tunes: arr(j.tunes, 'tunes').map((v) => {
			const hit: SearchHit = tuneSummary(v);
			const alias = (v as Json).alias;
			if (typeof alias === 'string' && alias) hit.alias = alias;
			return hit;
		})
	});
}

export function parseTune(json: unknown): Tune {
	const j = obj(json, 'tune');
	return dedupeTune({
		...tuneSummary(j),
		aliases: arr(j.aliases, 'aliases').map((a) => str(a, 'alias')),
		tunebooks: num(j.tunebooks, 'tunebooks'),
		recordings: num(j.recordings, 'recordings'),
		member: member(j.member),
		settings: arr(j.settings, 'settings').map((v) => {
			const s = obj(v, 'setting');
			return {
				id: num(s.id, 'setting.id'),
				url: str(s.url, 'setting.url'),
				key: str(s.key, 'setting.key'),
				abc: str(s.abc, 'setting.abc'),
				member: member(s.member),
				date: str(s.date, 'setting.date')
			};
		})
	});
}

const TUNE_URL = /\/tunes\/(\d+)/;

export function parseSets(json: unknown): TuneSets {
	const j = obj(json, 'sets');
	return dedupeSets({
		...page(j),
		sets: arr(j.sets, 'sets').map((v) => {
			const s = obj(v, 'set');
			return {
				id: num(s.id, 'set.id'),
				name: str(s.name, 'set.name'),
				url: str(s.url, 'set.url'),
				date: str(s.date, 'set.date'),
				member: member(s.member),
				tunes: arr(s.settings, 'set.settings').map((v) => {
					const e = obj(v, 'set entry');
					const url = str(e.url, 'set entry url');
					const tuneId = TUNE_URL.exec(url)?.[1];
					if (!tuneId) throw new TheSessionError(`No tune id in ${url}`);
					return {
						settingId: num(e.id, 'set entry id'),
						tuneId: Number(tuneId),
						name: str(e.name, 'set entry name'),
						url,
						type: str(e.type, 'set entry type'),
						meter: str(e.meter, 'set entry meter'),
						key: str(e.key, 'set entry key')
					};
				})
			};
		})
	});
}

export function parseRecordings(json: unknown): TuneRecordings {
	const j = obj(json, 'recordings');
	return {
		id: num(j.id, 'id'),
		name: str(j.name, 'name'),
		recordings: uniqueById(
			arr(j.recordings, 'recordings').map((v) => {
				const r = obj(v, 'recording');
				const a = obj(r.artist, 'artist');
				return {
					id: num(r.id, 'recording.id'),
					name: str(r.name, 'recording.name'),
					url: str(r.url, 'recording.url'),
					artist: {
						id: num(a.id, 'artist.id'),
						name: str(a.name, 'artist.name'),
						url: str(a.url, 'artist.url')
					}
				};
			})
		),
		recordedWith: arr(j.recorded_with ?? [], 'recorded_with').map((v) => {
			const t = obj(v, 'recorded_with');
			return {
				id: num(t.id, 'recorded_with.id'),
				name: str(t.name, 'recorded_with.name'),
				count: num(t.number, 'recorded_with.number')
			};
		})
	};
}

const MODES: Record<string, string> = {
	maj: 'major',
	min: 'minor',
	dor: 'dorian',
	mix: 'mixolydian',
	lyd: 'lydian',
	phr: 'phrygian',
	loc: 'locrian',
	aeo: 'minor',
	ion: 'major'
};

/**
 * Splits a thesession key into tonic and mode. Tune settings use full names ("Edorian"), sets use
 * abbreviations ("Edor"); both normalize to `{ tonic: 'E', mode: 'dorian' }`.
 */
export function parseKey(key: string): { tonic: string; mode: string } | undefined {
	const m = /^([A-G][#b]?)\s*([a-z]+)$/i.exec(key.trim());
	if (!m) return undefined;
	const mode = MODES[m[2].slice(0, 3).toLowerCase()];
	if (!mode) return undefined;
	return { tonic: m[1][0].toUpperCase() + m[1].slice(1), mode };
}

/**
 * The opening `bars` bars of a setting's ABC, as a first-notes hint. A short leading bar is
 * treated as a pickup and kept without being counted.
 */
export function firstBars(abc: string, bars = 2): string {
	const segments = abc
		.replace(/!/g, ' ')
		.split(/:?\|+[:\]]?|\[\d/)
		.map((s) => s.trim().replace(/\s+/g, ' '))
		.filter((s) => s.length > 0);
	if (segments.length === 0) return '';
	const pickup = segments.length > 1 && segments[0].length * 2 < segments[1].length ? 1 : 0;
	return segments.slice(0, bars + pickup).join(' | ');
}

export interface TheSessionClientOptions {
	fetch?: typeof fetch;
	origin?: string;
}

export interface SearchOptions {
	page?: number;
	perpage?: number;
	/** Restrict to one tune type, e.g. "reel". */
	type?: string;
}

export class TheSessionClient {
	#fetch: typeof fetch;
	#origin: string;

	constructor(options: TheSessionClientOptions = {}) {
		this.#fetch = options.fetch ?? ((...args) => fetch(...args));
		this.#origin = options.origin ?? THESESSION_ORIGIN;
	}

	async #get(path: string, params: Record<string, string | number | undefined> = {}) {
		const url = new URL(path, this.#origin);
		for (const [k, v] of Object.entries(params)) {
			if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
		}
		url.searchParams.set('format', 'json');
		const res = await this.#fetch(url);
		if (!res.ok) throw new TheSessionError(`${res.status} from ${url.pathname}`, res.status);
		return res.json() as Promise<unknown>;
	}

	async search(q: string, options: SearchOptions = {}): Promise<SearchResults> {
		return parseSearch(await this.#get('/tunes/search', { q, ...options }));
	}

	async tune(id: number): Promise<Tune> {
		return parseTune(await this.#get(`/tunes/${id}`));
	}

	/** Paged, 10 per page; `perpage` is ignored by this endpoint. */
	async tuneSets(id: number, page?: number): Promise<TuneSets> {
		return parseSets(await this.#get(`/tunes/${id}/sets`, { page }));
	}

	/** Not paged: returns every recording at once. */
	async tuneRecordings(id: number): Promise<TuneRecordings> {
		return parseRecordings(await this.#get(`/tunes/${id}/recordings`));
	}
}
