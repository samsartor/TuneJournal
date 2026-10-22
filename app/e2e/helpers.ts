import { expect, type Page, type TestInfo } from '@playwright/test';

export const isMobile = (info: TestInfo) => info.project.name === 'mobile';

/** Opens the app with the public sync relay blocked, so tests stay local and hermetic. */
export async function open(page: Page, path = '/') {
	await page.routeWebSocket(/sync\.automerge\.org/, (ws) => ws.close());
	await page.goto(path);
	await expect(page.getByText(/\d+ pieces?|No tunes yet/).first()).toBeVisible();
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
