import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';
import { PORT, SYNC_PORT } from './e2e/ports';

// Use Playwright's own Chromium when it's installed, else the system one.
const SYSTEM_CHROMIUM = '/usr/sbin/chromium';
const executablePath =
	process.env.PLAYWRIGHT_CHROMIUM_PATH ??
	(existsSync(SYSTEM_CHROMIUM) ? SYSTEM_CHROMIUM : undefined);

// A local sync relay (e2e/sync-server.ts), so tests never touch the public one. Both ports can be
// moved with E2E_PORT and E2E_SYNC_PORT (e2e/ports.ts).
const SYNC_URL = `ws://localhost:${SYNC_PORT}`;

export default defineConfig({
	testDir: 'e2e',
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	reporter: 'list',
	use: {
		baseURL: `http://localhost:${PORT}`,
		browserName: 'chromium',
		launchOptions: { executablePath },
		trace: 'retain-on-failure'
	},
	projects: [
		{
			name: 'mobile',
			use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
		},
		{ name: 'desktop', use: { viewport: { width: 1280, height: 800 } } }
	],
	webServer: [
		{
			command: 'node e2e/sync-server.ts',
			env: { SYNC_PORT: String(SYNC_PORT) },
			port: SYNC_PORT,
			reuseExistingServer: false,
			timeout: 30_000
		},
		{
			// Test the production build, service worker included, pointed at the local relay.
			command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
			env: { PUBLIC_SYNC_URL: SYNC_URL },
			port: PORT,
			reuseExistingServer: false,
			timeout: 180_000
		}
	]
});
