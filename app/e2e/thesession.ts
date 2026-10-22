import { readFileSync } from 'node:fs';
import { expect, type Page, type TestInfo } from '@playwright/test';
import { isMobile } from './helpers';

const FIXTURES = new URL('../src/lib/integrations/fixtures/', import.meta.url);
export const fixture = (name: string) => readFileSync(new URL(name, FIXTURES), 'utf8');

const EMPTY_SEARCH = JSON.stringify({ format: 'json', page: 1, pages: 0, total: 0, tunes: [] });

/**
 * Serves thesession.org from the recorded fixtures, so tests never reach the real site. Anything
 * without a fixture gets a 404. `overrides` replaces the body for a path. Returns the list of
 * requested paths. On the context, so it holds for every page and survives reloads.
 */
export async function mockTheSession(page: Page, overrides: Record<string, string> = {}) {
	const requests: string[] = [];
	await page.context().route('https://thesession.org/**', async (route) => {
		const url = new URL(route.request().url());
		requests.push(url.pathname + url.search);
		let body: string | undefined;
		if (url.pathname in overrides) {
			body = overrides[url.pathname];
		} else if (url.pathname === '/tunes/search') {
			body = /cooley/i.test(url.searchParams.get('q') ?? '')
				? fixture('search-cooley.json')
				: EMPTY_SEARCH;
		} else if (url.pathname === '/tunes/1') {
			body = fixture('tune-1.json');
		} else if (url.pathname === '/tunes/1/sets') {
			body = fixture('tune-1-sets.json');
		} else if (url.pathname === '/tunes/1/recordings') {
			body = fixture('tune-1-recordings.json');
		}
		await route.fulfill({
			status: body ? 200 : 404,
			contentType: 'application/json',
			headers: { 'access-control-allow-origin': '*' },
			body: body ?? '{}'
		});
	});
	return requests;
}

/** From the open edit modal: search thesession.org for `query` and wait for the results. */
export async function searchTheSession(page: Page, query: string) {
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('Title').fill(query);
	await dialog.getByRole('button', { name: 'Search thesession.org' }).click();
	const results = dialog.getByRole('list', { name: 'thesession.org results' });
	await expect(results.getByRole('button').first()).toBeVisible();
	return results;
}

/**
 * Adds a tune by searching thesession.org for "cooley" and picking the Cooley's reel, then its
 * first setting. Leaves the modal open. `title` is typed first, as the search text.
 */
export async function addCooleys(page: Page, info: TestInfo, title = 'cooley') {
	if (isMobile(info)) await page.getByRole('button', { name: 'Add tune' }).click();
	else await page.getByRole('button', { name: 'Add +' }).click();
	const dialog = page.getByRole('dialog');
	await expect(dialog.getByRole('heading', { name: 'New tune' })).toBeVisible();
	const results = await searchTheSession(page, title);
	await results.getByRole('button', { name: /^Cooley's\s+Reel/ }).click();
	return dialog;
}
