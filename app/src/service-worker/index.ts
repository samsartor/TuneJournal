import { self } from '$app/service-worker';
import { immutable, assets } from '$app/manifest';

declare const __BUILD_ID__: string;

const CACHE = `tunejournal-${__BUILD_ID__}`;

const scoped = (path: string) => new URL(path, self.registration.scope).href;

// The SPA fallback page isn't listed in the manifest, so cache the app root explicitly.
const SHELL = scoped('./');
const PRECACHE = [SHELL, ...[...immutable, ...assets].map(({ path }) => scoped(path))];
const PRECACHED = new Set(PRECACHE);

self.addEventListener('install', (event) => {
	// No skipWaiting() here: the page prompts the user and posts SKIP_WAITING when they accept.
	event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			for (const key of await caches.keys()) {
				if (key !== CACHE) await caches.delete(key);
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
	if (request.method !== 'GET') return;
	const url = new URL(request.url);
	if (url.origin !== self.location.origin) return;

	if (request.mode === 'navigate') {
		// Cache-first app shell; new versions arrive through the service worker update flow.
		event.respondWith(caches.match(SHELL).then((cached) => cached ?? fetch(request)));
		return;
	}

	url.search = '';
	if (PRECACHED.has(url.href)) {
		event.respondWith(caches.match(url.href).then((cached) => cached ?? fetch(request)));
	}
});
