import { expect, test } from '@playwright/test';
import { RELAY, addTune, backToList, card, cards, isMobile, open } from './helpers';

test.beforeEach(async ({ page }) => {
	// These tests are about this device alone. Without the relay, nothing lost locally can come back
	// from it, so the reload tests really check local persistence.
	await page.routeWebSocket(RELAY, (ws) => ws.close());
	await open(page);
});

test('adds a tune and edits title, tags, skill and key', async ({ page }, info) => {
	await addTune(page, info, {
		title: 'Cooley’s',
		tags: ['Reel', 'Session'],
		skill: 3,
		key: 'Edor',
		firstNotes: 'D2 | EBBA B2 EB'
	});

	const c = card(page, 'Cooley’s');
	await expect(c).toBeVisible();
	await expect(c.getByText('E dor')).toBeVisible();
	await expect(c.getByRole('listitem')).toHaveText(['Reel', 'Session']);
	await expect(c.getByRole('img', { name: 'Skill 3 of 5: Getting there' })).toBeVisible();
	await expect(c.getByText('Never practiced')).toBeVisible();

	// The detail view shows everything, and editing again keeps the values.
	await c.getByRole('link', { name: 'Cooley’s' }).click();
	await expect(page).toHaveURL(/\/piece\/\w+$/);
	await expect(page.getByRole('heading', { level: 1, name: 'Cooley’s' })).toBeVisible();
	await expect(page.getByText('D2 | EBBA B2 EB')).toBeVisible();
	await page.getByRole('button', { name: 'Edit' }).click();
	const dialog = page.getByRole('dialog');
	await expect(dialog.getByLabel('Title')).toHaveValue('Cooley’s');
	await expect(dialog.getByLabel('Key as text')).toHaveValue('E dorian');

	await dialog.getByRole('button', { name: 'Remove tag Session' }).click();
	await dialog.getByRole('button', { name: 'Clear rating' }).click();
	await dialog.getByRole('button', { name: 'Done' }).click();
	await backToList(page, info);
	await expect(c.getByRole('listitem')).toHaveText(['Reel']);
	await expect(c.getByText('unrated')).toBeVisible();
});

test('tag input suggests existing tags and keeps their casing', async ({ page }, info) => {
	await addTune(page, info, { title: 'The Kesh', tags: ['Jig'] });
	await addTune(page, info, { title: 'Drowsy Maggie', tags: ['Reel'] });
	await card(page, 'The Kesh')
		.getByRole('button', { name: /More actions/ })
		.click();
	await page.getByRole('menuitem', { name: 'Edit' }).click();

	const dialog = page.getByRole('dialog');
	const tags = dialog.getByRole('combobox', { name: 'Tags' });
	const options = dialog.getByRole('listbox', { name: 'Tag suggestions' }).getByRole('option');
	await tags.fill('re');
	await expect(options).toHaveText([/^Reel\s*1$/, 'Create “re”']);
	await tags.press('Enter');
	await tags.fill('new tag,');
	await expect(dialog.getByRole('list', { name: 'Current tags' }).getByRole('listitem')).toHaveText(
		[/Jig/, /new tag/, /Reel/]
	);
	await tags.fill('REEL');
	await expect(options).toHaveCount(0);
	await dialog.getByRole('button', { name: 'Done' }).click();
	await expect(card(page, 'The Kesh').getByRole('listitem')).toHaveText(['Jig', 'new tag', 'Reel']);
});

test('search finds a tune by title', async ({ page }, info) => {
	await addTune(page, info, { title: 'The Kesh' });
	await addTune(page, info, { title: 'Drowsy Maggie' });
	const search = page.getByRole('searchbox', { name: 'Search' });
	await search.fill('kesh');
	await expect(cards(page)).toHaveCount(1);
	await expect(card(page, 'The Kesh')).toBeVisible();
	await search.fill('nothing like this');
	await expect(page.getByText('Nothing matches.')).toBeVisible();
	await search.fill('');
	await expect(cards(page)).toHaveCount(2);
});

test('filters by tag, and remembers the filter', async ({ page }, info) => {
	await addTune(page, info, { title: 'The Kesh', tags: ['Jig'] });
	await addTune(page, info, { title: 'Drowsy Maggie', tags: ['Reel'] });

	await page.getByRole('button', { name: /Filter & sort/ }).click();
	await page.getByRole('combobox', { name: 'Tags' }).selectOption('Reel');
	await expect(cards(page)).toHaveCount(1);
	await expect(card(page, 'Drowsy Maggie')).toBeVisible();
	await expect(page.getByText('1 of 2')).toBeVisible();

	await page.reload();
	await expect(cards(page)).toHaveCount(1);

	await page.getByRole('button', { name: 'Clear filters' }).click();
	await expect(cards(page)).toHaveCount(2);
});

test('practiced updates "last practiced", with undo', async ({ page }, info) => {
	await addTune(page, info, { title: 'Morrison’s' });
	const c = card(page, 'Morrison’s');
	await expect(c.getByTestId('last-practiced')).toHaveText('Never practiced');
	await c.getByRole('button', { name: 'Practiced ✓' }).click();
	await expect(c.getByTestId('last-practiced')).toHaveText('Last practiced just now');

	await page.getByRole('button', { name: 'Undo' }).click();
	await expect(c.getByTestId('last-practiced')).toHaveText('Never practiced');

	await c.getByRole('button', { name: 'Practiced ✓' }).click();
	await c.getByRole('link', { name: 'Morrison’s' }).click();
	await expect(page.locator('.detail').getByTestId('last-practiced')).toContainText(
		'Last practiced just now · 1 time'
	);
	await expect(page.locator('.history li')).toHaveCount(1);
});

test('delete with undo', async ({ page }, info) => {
	await addTune(page, info, { title: 'Out on the Ocean' });
	const c = card(page, 'Out on the Ocean');
	await c.getByRole('button', { name: 'More actions for Out on the Ocean' }).click();
	await page.getByRole('menuitem', { name: 'Delete' }).click();
	await expect(c).toBeHidden();
	await expect(page.getByText('Deleted “Out on the Ocean”')).toBeVisible();
	await page.getByRole('button', { name: 'Undo' }).click();
	await expect(c).toBeVisible();
});

test('the library survives a reload', async ({ page }, info) => {
	await addTune(page, info, { title: 'Banish Misfortune', tags: ['Jig'], key: 'Dmix' });
	await page.reload();
	const c = card(page, 'Banish Misfortune');
	await expect(c).toBeVisible();
	await expect(c.getByText('D mix')).toBeVisible();

	// The detail route also survives a reload (the selection lives in the URL).
	await c.getByRole('link', { name: 'Banish Misfortune' }).click();
	await expect(page).toHaveURL(/\/piece\/\w+$/);
	const url = page.url();
	await page.reload();
	expect(page.url()).toBe(url);
	await expect(page.getByRole('heading', { level: 1, name: 'Banish Misfortune' })).toBeVisible();
	if (!isMobile(info)) await expect(card(page, 'Banish Misfortune')).toBeVisible();
});

test('works offline after the first load', async ({ page, context }, info) => {
	await page.evaluate(() => navigator.serviceWorker.ready);
	await addTune(page, info, { title: 'Offline Reel' });
	await context.setOffline(true);
	await page.reload();
	await expect(card(page, 'Offline Reel')).toBeVisible();
	await addTune(page, info, { title: 'Added offline' });
	await expect(card(page, 'Added offline')).toBeVisible();
	await context.setOffline(false);
});

test('a change made in the same moment as a reload survives it', async ({ page }, info) => {
	await addTune(page, info, { title: 'The Butterfly' });
	const c = card(page, 'The Butterfly');
	await expect(c.getByTestId('last-practiced')).toHaveText('Never practiced');
	// Click and reload in one task, so the IndexedDB write can't finish before the page goes.
	await page.evaluate(() => {
		const button = [...document.querySelectorAll('button')].find((b) =>
			b.textContent?.includes('Practiced ✓')
		);
		button?.click();
		location.reload();
	});
	await page.waitForEvent('load');
	await expect(card(page, 'The Butterfly').getByTestId('last-practiced')).toHaveText(
		'Last practiced just now'
	);
});
