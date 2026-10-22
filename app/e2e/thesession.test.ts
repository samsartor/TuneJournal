import { expect, test } from '@playwright/test';
import { RELAY, backToList, card, cards, isMobile, open } from './helpers';
import { addCooleys, mockTheSession, searchTheSession } from './thesession';

test.beforeEach(async ({ page }) => {
	await page.routeWebSocket(RELAY, (ws) => ws.close());
});

test('search fills title, type tag, link, key and first notes from a setting', async ({
	page
}, info) => {
	const requests = await mockTheSession(page);
	await open(page);
	const dialog = await addCooleys(page, info);

	// "cooley" isn't "Cooley's", so it asks before replacing the title.
	await expect(dialog.getByText("Replace the title “cooley” with “Cooley's”?")).toBeVisible();
	await dialog.getByRole('button', { name: "Use “Cooley's”" }).click();
	await expect(dialog.getByLabel('Title')).toHaveValue("Cooley's");

	await expect(dialog.getByText("“Cooley's” has 3 settings.")).toBeVisible();
	await dialog.getByRole('button', { name: /^Setting 2, E min:/ }).click();

	// The setting's key and first notes go on the thesession recording; the tune inherits them.
	await expect(dialog.getByLabel('Key as text')).toHaveValue('');
	await expect(dialog.getByTestId('key-inherited')).toHaveText(
		'Uses E min from thesession.org until you set one.'
	);
	await expect(dialog.getByLabel(/First notes/)).toHaveValue('');
	await expect(dialog.getByLabel(/First notes/)).toHaveAttribute(
		'placeholder',
		'F | CGGC G2 CG | G2 FG BGFE'
	);
	await expect(dialog.getByRole('list', { name: 'Current tags' })).toHaveText(/Reel/);
	await expect(
		dialog.getByRole('link', { name: 'thesession.org tune 1, setting 12342 ↗' })
	).toHaveAttribute('href', 'https://thesession.org/tunes/1');
	await dialog.getByRole('button', { name: 'Done' }).click();

	// The detail view shows the link and what thesession.org knows about the tune.
	const detail = page.locator('.detail');
	await expect(detail.getByTestId('key')).toHaveText(/E min\s+from thesession\.org/);
	await expect(detail.getByTestId('first-notes')).toHaveText(
		/F \| CGGC G2 CG \| G2 FG BGFE\s+from thesession\.org/
	);
	await expect(detail.getByRole('link', { name: 'Open thesession.org (new tab)' })).toHaveAttribute(
		'href',
		'https://thesession.org/tunes/1'
	);
	await expect(detail.getByTestId('aliases')).toContainText('The Tulla');
	await expect(detail.getByText('(E min ×2, E dor ×1)')).toBeVisible();
	await expect(detail.getByText('6,826')).toBeVisible();

	await backToList(page, info);
	const c = card(page, "Cooley's");
	await expect(c.getByText('E min')).toBeVisible();
	await expect(c.getByRole('listitem')).toHaveText(['Reel']);
	expect(requests.every((r) => r.includes('format=json'))).toBe(true);
});

test('picking a tune already in the library offers to merge into it', async ({ page }, info) => {
	await mockTheSession(page);
	await open(page);
	let dialog = await addCooleys(page, info, "Cooley's");
	await dialog.getByRole('button', { name: /^Setting 1,/ }).click();
	await dialog.getByRole('button', { name: 'Done' }).click();
	await expect(page).toHaveURL(/\/piece\/\w+$/);
	const first = page.url();
	await page.locator('.detail').getByRole('button', { name: 'Practiced ✓' }).click();
	await backToList(page, info);

	dialog = await addCooleys(page, info, "Cooley's");
	await expect(dialog.getByText("“Cooley's” is already in your library.")).toBeVisible();
	const second = page.url();
	expect(second).not.toBe(first);
	await dialog.getByRole('button', { name: 'Merge into existing' }).click();

	await expect(dialog).toBeHidden();
	await expect(page).toHaveURL(first);
	await expect(page.getByText("Merged into “Cooley's”")).toBeVisible();
	await expect(page.locator('.detail').getByTestId('last-practiced')).toContainText('1 time');

	// The merged-away piece redirects to the one it was merged into.
	await page.goto(second);
	await expect(page).toHaveURL(first);
	await backToList(page, info);
	await expect(cards(page)).toHaveCount(1);
});

test('duplicates get a banner, and the merge dialog picks fields', async ({ page }, info) => {
	await mockTheSession(page);
	await open(page);
	let dialog = await addCooleys(page, info, "Cooley's");
	await dialog.getByRole('button', { name: /^Setting 1,/ }).click();
	await dialog.getByRole('button', { name: 'Done' }).click();
	await backToList(page, info);

	dialog = await addCooleys(page, info, 'Joe Cooley');
	await dialog.getByRole('button', { name: 'Keep my title' }).click();
	await dialog.getByRole('button', { name: 'Keep both' }).click();
	await dialog.getByRole('button', { name: 'Skip' }).click();
	await dialog.getByRole('button', { name: 'Done' }).click();
	await backToList(page, info);

	await expect(cards(page)).toHaveCount(2);
	const banner = page.getByRole('status').filter({ hasText: 'the same thesession tune' });
	await expect(banner).toHaveText(/2 pieces are the same thesession tune/);
	await banner.getByRole('button', { name: 'Review' }).click();

	const merge = page.getByRole('dialog', { name: 'Merge 2 pieces' });
	await expect(merge.getByRole('group', { name: 'Keep' }).getByRole('radio')).toHaveCount(2);
	const title = merge.getByRole('group', { name: 'Title' });
	await expect(title.getByRole('radio', { name: "Cooley's" })).toBeChecked();
	await title.getByRole('radio', { name: 'Joe Cooley' }).check();
	await merge.getByRole('button', { name: 'Merge' }).click();
	await expect(merge).toBeHidden();
	await expect(page.getByText('Merged 2 pieces into “Joe Cooley”')).toBeVisible();

	await backToList(page, info);
	await expect(cards(page)).toHaveCount(1);
	await expect(card(page, 'Joe Cooley')).toBeVisible();
	await expect(banner).toBeHidden();
});

test('promotes a suggested set into a Set with its tunes', async ({ page }, info) => {
	await mockTheSession(page);
	await open(page);
	const dialog = await addCooleys(page, info, "Cooley's");
	await dialog.getByRole('button', { name: /^Setting 1,/ }).click();
	await dialog.getByRole('button', { name: 'Done' }).click();

	const detail = page.locator('.detail');
	const sets = detail.getByRole('list', { name: 'Appears in sets' });
	const set = sets.getByRole('listitem').filter({ hasText: 'Drowsy Maggie' }).first();
	await expect(set.getByRole('link', { name: "Cooley's" })).toBeVisible();
	await expect(set.getByText('(in library)')).toHaveCount(1);
	await set.getByRole('button', { name: 'Add to library' }).click();
	await expect(page.getByText('Added a set of 3 tunes (2 new)')).toBeVisible();
	await expect(set.getByText('(in library)')).toHaveCount(3);

	await set.getByRole('link', { name: 'Open set' }).click();
	await expect(
		page.getByRole('heading', { level: 1, name: "Drowsy Maggie / The Kesh / Cooley's" })
	).toBeVisible();
	await expect(detail.getByRole('list', { name: 'Contains' }).getByRole('link')).toHaveText([
		'Drowsy Maggie',
		'The Kesh',
		"Cooley's"
	]);

	await detail
		.getByRole('list', { name: 'Contains' })
		.getByRole('link', { name: 'The Kesh' })
		.click();
	await expect(page.getByRole('heading', { level: 1, name: 'The Kesh' })).toBeVisible();
	// The set's key is on the new tune's thesession recording, and the tune shows it from there.
	await expect(detail.getByTestId('key')).toHaveText(/G maj\s+from thesession\.org/);
	await expect(detail.getByRole('list', { name: 'Part of' }).getByRole('link')).toHaveText([
		"Drowsy Maggie / The Kesh / Cooley's"
	]);

	await backToList(page, info);
	await expect(cards(page)).toHaveCount(3);
});

test('list search matches cached thesession aliases, after a reload too', async ({
	page
}, info) => {
	await mockTheSession(page);
	await open(page);
	const dialog = await addCooleys(page, info, "Cooley's");
	await dialog.getByRole('button', { name: /^Setting 1,/ }).click();
	await dialog.getByRole('button', { name: 'Done' }).click();
	await backToList(page, info);

	const search = page.getByRole('searchbox', { name: 'Search' });
	await search.fill('tulla');
	await expect(cards(page)).toHaveCount(1);
	await expect(card(page, "Cooley's")).toBeVisible();

	await page.reload();
	await search.fill('cake dresser');
	await expect(card(page, "Cooley's")).toBeVisible();
	await search.fill('no such tune');
	await expect(cards(page)).toHaveCount(0);
});

test('thesession data shows offline from the cache, and can be cleared', async ({
	page,
	context
}, info) => {
	const requests = await mockTheSession(page);
	await open(page);
	await page.evaluate(() => navigator.serviceWorker.ready);
	const dialog = await addCooleys(page, info, "Cooley's");
	await dialog.getByRole('button', { name: /^Setting 1,/ }).click();
	await dialog.getByRole('button', { name: 'Done' }).click();
	const detail = page.locator('.detail');
	await expect(detail.getByTestId('aliases')).toContainText('The Tulla');
	await expect(detail.getByRole('button', { name: 'Add to library' }).first()).toBeVisible();
	const url = page.url();

	// Nothing can reach thesession.org now; everything comes from the cache.
	await page.unroute('https://thesession.org/**');
	const offlineRequests: string[] = [];
	await page.route('https://thesession.org/**', (route) => {
		offlineRequests.push(route.request().url());
		return route.abort('internetdisconnected');
	});
	await context.setOffline(true);
	await page.reload();
	expect(page.url()).toBe(url);
	await expect(detail.getByTestId('aliases')).toContainText('The Tulla');
	await expect(detail.getByRole('button', { name: 'Add to library' })).toHaveCount(2);

	// The 🔍 search works offline for a query searched before.
	await detail.getByRole('button', { name: 'Edit' }).click();
	const results = await searchTheSession(page, "Cooley's");
	await expect(results.getByRole('button', { name: /^Cooley's\s+Reel/ })).toBeVisible();
	await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
	expect(offlineRequests).toEqual([]);
	await context.setOffline(false);

	// Settings → Clear cached data empties it.
	if (isMobile(info)) await backToList(page, info);
	await page.getByRole('link', { name: 'Settings' }).click();
	await expect(page.getByTestId('cache-count')).toHaveText(/\d+ cached responses/);
	await page.getByRole('button', { name: 'Clear cached data' }).click();
	await expect(page.getByTestId('cache-count')).toHaveText('Nothing cached.');
	expect(requests.length).toBeGreaterThan(0);
});
