import { expect, type Browser, type Page, type TestInfo } from '@playwright/test';

export const isMobile = (info: TestInfo) => info.project.name === 'mobile';

/** The local relay from e2e/sync-server.ts, which the e2e build syncs through. */
export const RELAY = /localhost:3031/;

/**
 * Opens the app. The e2e build syncs through the local relay; the public one is blocked as well,
 * in case a build without PUBLIC_SYNC_URL sneaks in, so tests stay hermetic.
 */
export async function open(page: Page, path = '/') {
	await page.routeWebSocket(/sync\.automerge\.org/, (ws) => ws.close());
	await page.goto(path);
	await expect(page.getByText(/\d+ pieces?|No tunes yet/).first()).toBeVisible();
}

/** A second browser profile with the same viewport as the current project: another device. */
export async function newDevice(browser: Browser, info: TestInfo) {
	const { viewport, isMobile, hasTouch, baseURL } = info.project.use;
	const context = await browser.newContext({ viewport, isMobile, hasTouch, baseURL });
	const page = await context.newPage();
	await page.routeWebSocket(/sync\.automerge\.org/, (ws) => ws.close());
	return { context, page };
}

export const syncStatus = (page: Page) => page.getByTestId('sync-status').first();

/** Waits until the relay has everything this page has. */
export async function expectSynced(page: Page) {
	await expect(syncStatus(page)).toHaveAttribute('data-state', 'connected');
	await expect(syncStatus(page).locator('.label')).toHaveText('Synced');
}

export interface TuneFields {
	title: string;
	tags?: string[];
	skill?: number;
	key?: string;
	firstNotes?: string;
}

/** Adds a tune through (+) / "Add +" and fills in the edit modal. */
export async function addTune(page: Page, info: TestInfo, fields: TuneFields) {
	if (isMobile(info)) await page.getByRole('button', { name: 'Add tune' }).click();
	else await page.getByRole('button', { name: 'Add +' }).click();

	const dialog = page.getByRole('dialog');
	await expect(dialog.getByRole('heading', { name: 'New tune' })).toBeVisible();
	const title = dialog.getByLabel('Title');
	await expect(title).toBeFocused();
	await title.fill(fields.title);

	const tags = dialog.getByRole('combobox', { name: 'Tags' });
	for (const tag of fields.tags ?? []) {
		await tags.fill(tag);
		await tags.press('Enter');
	}
	if (fields.skill !== undefined) {
		await dialog.getByRole('slider', { name: 'Skill' }).fill(String(fields.skill));
	}
	if (fields.key) await dialog.getByLabel('Key as text').fill(fields.key);
	if (fields.firstNotes) await dialog.getByLabel(/First notes/).fill(fields.firstNotes);

	await dialog.getByRole('button', { name: 'Done' }).click();
	await expect(dialog).toBeHidden();
	await backToList(page, info);
}

/** On mobile the detail view replaces the list; on desktop the list is always there. */
export async function backToList(page: Page, info: TestInfo) {
	if (isMobile(info)) await page.getByRole('link', { name: '← All pieces' }).click();
	await expect(page.getByRole('searchbox', { name: 'Search' })).toBeVisible();
}

const list = (page: Page) => page.getByRole('region', { name: 'Library' });
export const cards = (page: Page) => list(page).getByRole('article');
export const card = (page: Page, title: string) => list(page).getByRole('article', { name: title });

/** Opens the edit modal for a piece from its card's menu. */
export async function editFromCard(page: Page, title: string) {
	await card(page, title)
		.getByRole('button', { name: `More actions for ${title}` })
		.click();
	await page.getByRole('menuitem', { name: 'Edit' }).click();
	const dialog = page.getByRole('dialog');
	await expect(dialog).toBeVisible();
	return dialog;
}

/** Goes to Settings → Link a device and returns this library's deep link. */
export async function deepLinkOf(page: Page): Promise<string> {
	await page.getByRole('link', { name: 'Settings' }).click();
	await page.getByRole('link', { name: 'Link a device' }).click();
	await expect(page.getByRole('img', { name: 'QR code linking to this library' })).toBeVisible();
	const link = await page.getByTestId('deep-link').textContent();
	expect(link).toMatch(/\/link-device#automerge:\w+$/);
	await page.getByRole('link', { name: '← Settings' }).click();
	await page.getByRole('link', { name: '← All pieces' }).click();
	return link!;
}
