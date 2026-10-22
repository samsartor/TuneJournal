import { defineConfig } from 'vitest/config';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import wasm from 'vite-plugin-wasm';

export default defineConfig({
	plugins: [
		wasm(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			// Pure SPA: every unknown path falls back to index.html, which boots the client router.
			adapter: adapter({ fallback: 'index.html' }),
			// The service worker serves one cached shell for every route, so its asset URLs must not
			// be relative to the page (`vite preview` renders `./_app/...` otherwise).
			paths: { relative: false }
		})
	],
	define: {
		// `version` from $app/env is undefined inside the service worker (Kit 3.1), so stamp our own.
		__BUILD_ID__: JSON.stringify(Date.now().toString(36))
	},
	worker: {
		format: 'es',
		plugins: () => [wasm()]
	},
	build: {
		// Automerge's WASM bindings use top-level await.
		target: 'esnext'
	},
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
