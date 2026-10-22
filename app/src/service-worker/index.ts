import { self } from '$app/service-worker';
import { immutable, assets } from '$app/manifest';
import { handleShareTarget, isShareTarget } from '#lib/integrations/share-target.ts';

declare const __BUILD_ID__: string;

// Vite only substitutes `define`s at build time here, so the dev server leaves it undeclared.
const CACHE = `tunejournal-${typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev'}`;

const scoped = (path: string) => new URL(path, self.registration.scope).href;

// The synth's instrument samples (static/soundfont/, a few MB in all) aren't precached: each
// note is cached the first time a rendering asks for it, in a cache that outlives app updates
// (the files never change; bump the version if they do). Renderings then work offline for every
// instrument and pitch already heard (PLAN.md §14 "Synthesized playback").
const SOUNDFONT_CACHE = 'tunejournal-soundfont-v1';
const SOUNDFONT = scoped('soundfont/');

// The SPA fallback page isn't listed in the manifest, so cache the app root explicitly.
const SHELL = scoped('./');
const PRECACHE = [
	SHELL,
	...[...immutable, ...assets]
		.map(({ path }) => scoped(path))
		.filter((url) => !url.startsWith(SOUNDFONT))
];
const PRECACHED = new Set(PRECACHE);

async function soundfont(request: Request): Promise<Response> {
	const cache = await caches.open(SOUNDFONT_CACHE);
	const cached = await cache.match(request, { ignoreSearch: true });
	if (cached) return cached;
	const response = await fetch(request);
	// The host answers unknown paths with the app page (SPA fallback); never keep that as a sample.
	const html = response.headers.get('content-type')?.includes('text/html');
	if (response.ok && !html) await cache.put(request, response.clone());
	return response;
}

self.addEventListener('install', (event) => {
	// No skipWaiting() here: the page prompts the user and posts SKIP_WAITING when they accept.
	event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			for (const key of await caches.keys()) {
				if (key !== CACHE && key !== SOUNDFONT_CACHE) await caches.delete(key);
			}
			await self.clients.claim();
		})()
	);
});

self.addEventListener('message', (event) => {
	if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
	const { request } = event;
	if (isShareTarget(request, self.registration.scope)) {
		event.respondWith(handleShareTarget(request, self.registration.scope));
		return;
	}
	if (request.method !== 'GET') return;
	const url = new URL(request.url);
	if (url.origin !== self.location.origin) return;

	if (request.mode === 'navigate') {
		// Cache-first app shell; new versions arrive through the service worker update flow.
		event.respondWith(caches.match(SHELL).then((cached) => cached ?? fetch(request)));
		return;
	}

	url.search = '';
	if (url.href.startsWith(SOUNDFONT)) {
		event.respondWith(soundfont(request));
		return;
	}
	if (PRECACHED.has(url.href)) {
		event.respondWith(caches.match(url.href).then((cached) => cached ?? fetch(request)));
	}
});
