// Recognises pasted or shared links (PLAN.md §7): which provider, the id to dedupe by, and a
// canonical URL. Pure, so it runs in tests and in the service worker alike.

import type { Provider } from '#lib/domain/types.ts';

export interface DetectedLink {
	provider: Provider;
	/** Canonical URL, stored on the Source. */
	url: string;
	/** Provider id: YouTube video id, Spotify `track:…`, Drive file id, thesession tune id. */
	externalId?: string;
	/** A start time carried in the link (YouTube `t=`), in seconds. */
	start?: number;
}

const YOUTUBE_HOSTS = /^(?:www\.|m\.|music\.)?youtube(?:-nocookie)?\.com$/;
const VIDEO_ID = /^[\w-]{11}$/;
const SPOTIFY_KINDS = new Set(['track', 'album', 'playlist', 'episode', 'show', 'artist']);

/** Parses "90", "90s", "1m30s", "1h2m3s" into seconds. */
export function parseTimestamp(value: string | null | undefined): number | undefined {
	if (!value) return undefined;
	if (/^\d+(?:\.\d+)?s?$/.test(value)) return Number.parseFloat(value);
	const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value);
	if (!m || !m[0]) return undefined;
	return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

/** The first http(s) URL in some shared text, e.g. "Listen: https://… (via Recorder)". */
export function findUrl(text: string): string | undefined {
	return /\bhttps?:\/\/[^\s<>"']+/i.exec(text)?.[0].replace(/[).,;!?]+$/, '');
}

function youtubeId(u: URL): string | undefined {
	if (u.hostname === 'youtu.be') {
		const id = u.pathname.slice(1).split('/')[0];
		return VIDEO_ID.test(id) ? id : undefined;
	}
	if (!YOUTUBE_HOSTS.test(u.hostname)) return undefined;
	const v = u.searchParams.get('v');
	if (v && VIDEO_ID.test(v)) return v;
	return /^\/(?:shorts|embed|live|v)\/([\w-]{11})(?:[/?]|$)/.exec(u.pathname)?.[1];
}

/**
 * What a pasted string links to, or undefined if it isn't an http(s) URL (a bare `spotify:` URI
 * is accepted too). Unknown sites come back as provider `url`.
 */
export function detectLink(input: string): DetectedLink | undefined {
	const text = input.trim();
	const spotifyUri = /^spotify:(track|album|playlist|episode|show|artist):([A-Za-z0-9]+)$/.exec(
		text
	);
	if (spotifyUri) {
		const [, kind, id] = spotifyUri;
		return {
			provider: 'spotify',
			url: `https://open.spotify.com/${kind}/${id}`,
			externalId: `${kind}:${id}`
		};
	}

	let u: URL;
	try {
		u = new URL(text);
	} catch {
		return undefined;
	}
	if (u.protocol !== 'https:' && u.protocol !== 'http:') return undefined;
	const host = u.hostname.toLowerCase();

	const video = youtubeId(u);
	if (video) {
		const start = parseTimestamp(u.searchParams.get('t') ?? u.searchParams.get('start'));
		const link: DetectedLink = {
			provider: 'youtube',
			url: `https://www.youtube.com/watch?v=${video}`,
			externalId: video
		};
		if (start) link.start = start;
		return link;
	}

	if (host === 'open.spotify.com') {
		// Paths look like /track/{id} or /intl-de/track/{id}.
		const parts = u.pathname.split('/').filter(Boolean);
		if (parts[0]?.startsWith('intl-')) parts.shift();
		const [kind, id] = parts;
		if (kind && SPOTIFY_KINDS.has(kind) && id && /^[A-Za-z0-9]+$/.test(id)) {
			return {
				provider: 'spotify',
				url: `https://open.spotify.com/${kind}/${id}`,
				externalId: `${kind}:${id}`
			};
		}
		return { provider: 'spotify', url: u.href };
	}

	if (host === 'drive.google.com' || host === 'docs.google.com') {
		const id =
			/\/file\/d\/([\w-]+)/.exec(u.pathname)?.[1] ??
			(u.pathname === '/open' || u.pathname === '/uc' ? u.searchParams.get('id') : null);
		if (id) {
			return {
				provider: 'gdrive',
				url: `https://drive.google.com/file/d/${id}/view`,
				externalId: id
			};
		}
	}

	if (host === 'thesession.org' || host === 'www.thesession.org') {
		const tune = /^\/tunes\/(\d+)/.exec(u.pathname)?.[1];
		if (tune) {
			return {
				provider: 'thesession',
				url: `https://thesession.org/tunes/${tune}`,
				externalId: tune
			};
		}
		return { provider: 'thesession', url: u.href };
	}

	if (host === 'folkfriend.app' || host === 'www.folkfriend.app') {
		return { provider: 'folkfriend', url: 'https://folkfriend.app/' };
	}

	u.hash = '';
	return { provider: 'url', url: u.href, externalId: u.href };
}
