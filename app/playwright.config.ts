import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

// Use Playwright's own Chromium when it's installed, else the system one.
const SYSTEM_CHROMIUM = '/usr/sbin/chromium';
const executablePath =
	process.env.PLAYWRIGHT_CHROMIUM_PATH ??
	(existsSync(SYSTEM_CHROMIUM) ? SYSTEM_CHROMIUM : undefined);

const PORT = 4173;

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
	webServer: {
		// Test the production build, service worker included.
		command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
		port: PORT,
		reuseExistingServer: false,
		timeout: 180_000
	}
});
