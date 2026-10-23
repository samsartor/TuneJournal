import { generateAutomergeUrl } from '@automerge/automerge-repo/slim';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import {
	RELAY,
	addTune,
	card,
	cards,
	deepLinkOf,
	editFromCard,
	expectSynced,
	newDevice,
	open,
	syncStatus
} from './helpers';
import { SYNC_PORT } from './ports';

/** Opens the deep link on `page` (a scan on another device) and links it, without merging. */
async function join(page: Page, link: string, { merge = false } = {}) {
	await page.goto(link);
	const confirm = page.getByRole('group', { name: 'Confirm linking' });
	await expect(confirm.getByText('Show this library on this device?')).toBeVisible();
	if (merge) await confirm.getByRole('checkbox', { name: /^Copy my \d+ pieces? into/ }).check();
	await confirm.getByRole('button', { name: 'Link this device' }).click();
	await expect(page.getByRole('searchbox', { name: 'Search' })).toBeVisible();
	await expect(page.getByText(/^Linked/)).toBeVisible();
}

async function addTag(page: Page, title: string, tag: string) {
	const dialog = await editFromCard(page, title);
	const tags = dialog.getByRole('combobox', { name: 'Tags' });
	await tags.fill(tag);
	await tags.press('Enter');
	await dialog.getByRole('button', { name: 'Done' }).click();
	await expect(dialog).toBeHidden();
}

/** Device A with one tune, synced to the relay, and device B linked to it. */
async function linkedPair(page: Page, browser: import('@playwright/test').Browser, info: TestInfo) {
	await open(page);
	await addTune(page, info, { title: 'The Kesh', tags: ['Jig'] });
	await expectSynced(page);
	const link = await deepLinkOf(page);

	const b = await newDevice(browser, info);
	await join(b.page, link);
	await expect(card(b.page, 'The Kesh')).toBeVisible();
	return b;
}

test('a second device joins through the deep link, and edits flow both ways', async ({
	page,
	browser
}, info) => {
	const b = await linkedPair(page, browser, info);
	await expect(card(b.page, 'The Kesh').getByRole('listitem')).toHaveText(['Jig']);
	await expect(b.page.getByText('1 piece', { exact: true })).toBeVisible();

	// B → A
	await addTune(b.page, info, { title: 'Drowsy Maggie', tags: ['Reel'] });
	await expect(card(page, 'Drowsy Maggie')).toBeVisible();

	// A → B, editing a piece B made
	await addTag(page, 'Drowsy Maggie', 'Session');
	await expect(card(b.page, 'Drowsy Maggie').getByRole('listitem')).toHaveText(['Reel', 'Session']);

	// Both stay linked after a reload.
	await b.page.reload();
	await expect(cards(b.page)).toHaveCount(2);
	await expectSynced(b.page);
	await b.context.close();
});

test('edits made offline converge without duplicate tags', async ({ page, browser }, info) => {
	const b = await linkedPair(page, browser, info);

	await b.context.setOffline(true);
	await expect(syncStatus(b.page)).toHaveAttribute('data-state', 'offline');

	// Both add the same tag to the same tune, and a tune of their own.
	await addTag(page, 'The Kesh', 'Session');
	await addTune(page, info, { title: 'Added on A' });
	await addTag(b.page, 'The Kesh', 'Session');
	await addTune(b.page, info, { title: 'Added on B' });
	await expect(card(page, 'Added on B')).toBeHidden();
	await expect(card(b.page, 'Added on A')).toBeHidden();

	await b.context.setOffline(false);
	for (const p of [page, b.page]) {
		await expect(cards(p)).toHaveCount(3);
		await expect(card(p, 'Added on A')).toBeVisible();
		await expect(card(p, 'Added on B')).toBeVisible();
		await expect(card(p, 'The Kesh').getByRole('listitem')).toHaveText(['Jig', 'Session']);
		await expectSynced(p);
	}
	await b.context.close();
});

test('joining can bring this device’s pieces along', async ({ page, browser }, info) => {
	await open(page);
	await addTune(page, info, { title: 'The Kesh' });
	await expectSynced(page);
	const link = await deepLinkOf(page);

	const b = await newDevice(browser, info);
	await open(b.page);
	await addTune(b.page, info, { title: 'Drowsy Maggie' });

	await b.page.goto(link);
	const confirm = b.page.getByRole('group', { name: 'Confirm linking' });
	await expect(confirm.getByText(/currently shows a library with 1 piece\./)).toBeVisible();
	await join(b.page, link, { merge: true });
	await expect(b.page.getByText(/added 1 piece from this device/)).toBeVisible();

	for (const p of [page, b.page]) {
		await expect(cards(p)).toHaveCount(2);
		await expect(card(p, 'The Kesh')).toBeVisible();
		await expect(card(p, 'Drowsy Maggie')).toBeVisible();
	}

	// B's old library is remembered, so it can switch back.
	await b.page.getByRole('link', { name: 'Settings' }).click();
	await b.page.getByText('Libraries this device showed before').click();
	await expect(b.page.getByRole('link', { name: 'Switch back' })).toHaveCount(1);
	await b.context.close();
});

test('joining without merging leaves the old library out', async ({ page, browser }, info) => {
	await open(page);
	await addTune(page, info, { title: 'The Kesh' });
	await expectSynced(page);
	const link = await deepLinkOf(page);

	const b = await newDevice(browser, info);
	await open(b.page);
	await addTune(b.page, info, { title: 'Drowsy Maggie' });
	await join(b.page, link);
	await expect(cards(b.page)).toHaveCount(1);
	await expect(card(b.page, 'The Kesh')).toBeVisible();
	await expect(card(page, 'Drowsy Maggie')).toBeHidden();
	await b.context.close();
});

test('joining explains why a library can’t be found', async ({ page, context }) => {
	await open(page);
	await expectSynced(page);

	// A malformed link.
	await page.goto('/link-device#automerge:nope');
	await expect(page.getByRole('alert')).toHaveText(/doesn’t contain a valid library address/);

	// A pasted address the relay has never seen.
	const missing = generateAutomergeUrl();
	await page.getByLabel('Library link or address').fill(` ${missing} `);
	await page.getByRole('button', { name: 'Continue' }).click();
	const confirm = page.getByRole('group', { name: 'Confirm linking' });
	await expect(confirm.getByTestId('pending-url')).toHaveText(missing);
	await confirm.getByRole('button', { name: 'Link this device' }).click();
	await expect(confirm.getByText('Looking for the library on the sync server…')).toBeVisible();
	await expect(confirm.getByRole('alert')).toHaveText(/sync server doesn’t have this library yet/, {
		timeout: 15_000
	});

	// Offline.
	await context.setOffline(true);
	await confirm.getByRole('button', { name: 'Try again' }).click();
	await expect(confirm.getByRole('alert')).toHaveText(/This device is offline/);
	await context.setOffline(false);

	// Cancelling goes back to the paste form, and this device keeps its library.
	await confirm.getByRole('button', { name: 'Cancel' }).click();
	await expect(page.getByLabel('Library link or address')).toBeVisible();
	await expect(page).toHaveURL(/\/link-device$/);
});

test.describe('sync status', () => {
	test('shows synced, then offline and back', async ({ page, context }, info) => {
		await open(page);
		await expectSynced(page);
		await addTune(page, info, { title: 'The Kesh' });
		await expectSynced(page);

		await context.setOffline(true);
		await expect(syncStatus(page)).toHaveAttribute('data-state', 'offline');
		await expect(syncStatus(page)).toContainText('Offline');
		await context.setOffline(false);
		await expectSynced(page);

		await page.getByRole('link', { name: 'Settings' }).click();
		await expect(page.getByTestId('sync-detail')).toHaveText(
			new RegExp(
				`^Connected to the sync server \\(localhost:${SYNC_PORT}\\)\\. Last synced just now\\.$`
			)
		);
	});

	test('shows connecting while the relay hasn’t answered', async ({ page }) => {
		// Accept the socket but never reply, like a relay that's slow to respond.
		await page.routeWebSocket(RELAY, () => {});
		await open(page);
		await expect(syncStatus(page)).toHaveAttribute('data-state', 'connecting');
		await expect(syncStatus(page)).toContainText('Connecting…');
	});

	test('shows offline when the relay is unreachable', async ({ page }) => {
		await page.routeWebSocket(RELAY, (ws) => ws.close());
		await open(page);
		await expect(syncStatus(page)).toHaveAttribute('data-state', 'offline');
		await page.getByRole('link', { name: 'Settings' }).click();
		await expect(page.getByTestId('sync-detail')).toHaveText(/^Can’t reach the sync server/);
	});
});
