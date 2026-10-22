import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { RELAY, addTune, backToList, card, cards, isMobile, open } from './helpers';
import { mockMedia, wav } from './media';

test.beforeEach(async ({ page }) => {
	await page.routeWebSocket(RELAY, (ws) => ws.close());
	await mockMedia(page);
	await open(page);
});

const details = (page: Page) => page.getByRole('region', { name: 'Details' });
const heading = (page: Page) => details(page).getByRole('heading', { level: 1 });
const related = (page: Page) => page.getByRole('region', { name: 'Related' });
const children = (page: Page) => page.getByTestId('child');
const player = (page: Page) => page.getByTestId('player');

/** Adds a piece of any kind; leaves its detail view open. */
async function addPiece(page: Page, info: TestInfo, title: string, kind: string) {
	if (isMobile(info)) await page.getByRole('button', { name: 'Add tune' }).click();
	else await page.getByRole('button', { name: 'Add +' }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('Title').fill(title);
	await dialog.getByLabel('Kind').selectOption({ label: kind });
	await dialog.getByRole('button', { name: 'Done' }).click();
	await expect(dialog).toBeHidden();
	await expect(heading(page)).toHaveText(title);
}

async function openPiece(page: Page, title: string) {
	await card(page, title).getByRole('link', { name: title }).click();
	await expect(heading(page)).toHaveText(title);
}

/** "+ Add <Kind>", then search and pick (or create with `create`). */
async function addChild(page: Page, label: string, query: string, create = false) {
	await related(page)
		.getByRole('button', { name: `+ ${label}` })
		.click();
	const group = related(page).getByRole('group', { name: label });
	await group.getByRole('searchbox').fill(query);
	if (create) await group.getByRole('button', { name: /^\+ New / }).click();
	else await group.getByRole('button', { name: `Add ${query}` }).click();
}

const childNames = (page: Page) => children(page).locator('a').allTextContents();

test('adds existing and new children, reorders and removes them', async ({ page }, info) => {
	await addTune(page, info, { title: 'Banish Misfortune' });
	await addTune(page, info, { title: 'Tobins' });
	await addPiece(page, info, 'Jig Set', 'Set');

	await expect(
		related(page).getByText('Not part of anything, and contains nothing.')
	).toBeVisible();
	await addChild(page, 'Add Tune', 'Banish Misfortune');
	await expect(page.getByText('Added “Banish Misfortune”')).toBeVisible();
	await addChild(page, 'Add Tune', 'Tobins');
	await addChild(page, 'Add Tune', 'Lark in the Morning', true);
	await expect(page.getByText('Added “Lark in the Morning”')).toBeVisible();
	await expect
		.poll(() => childNames(page))
		.toEqual(['Banish Misfortune', 'Tobins', 'Lark in the Morning']);
	await expect(related(page).getByRole('heading', { name: 'Contains 3' })).toBeVisible();

	// Pieces already in the set (and the set itself) aren't offered again.
	await related(page).getByRole('button', { name: '+ Add Tune' }).click();
	const picker = related(page).getByRole('group', { name: 'Add Tune' });
	await picker.getByRole('searchbox').fill('Banish');
	await expect(picker.getByText('Nothing matches.')).toBeVisible();
	await picker.getByRole('searchbox').fill('Jig Set');
	await expect(picker.getByText('Nothing matches.')).toBeVisible();
	await picker.getByRole('button', { name: 'Cancel' }).click();

	// Reorder with the buttons.
	await related(page).getByRole('button', { name: 'Move Lark in the Morning up' }).click();
	await expect
		.poll(() => childNames(page))
		.toEqual(['Banish Misfortune', 'Lark in the Morning', 'Tobins']);
	await expect(
		related(page).getByRole('button', { name: 'Move Banish Misfortune up' })
	).toBeDisabled();

	// …and by drag (pointer), on desktop.
	if (!isMobile(info)) {
		const handle = children(page).first().locator('.handle');
		const box = (await handle.boundingBox())!;
		const last = (await children(page).last().boundingBox())!;
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.mouse.down();
		await page.mouse.move(box.x + box.width / 2, last.y + last.height * 0.9, { steps: 8 });
		await page.mouse.up();
		await expect
			.poll(() => childNames(page))
			.toEqual(['Lark in the Morning', 'Tobins', 'Banish Misfortune']);
	}

	// Remove with undo: the link goes, never the piece.
	const order = await childNames(page);
	await related(page).getByRole('button', { name: 'Remove Tobins from Jig Set' }).click();
	await expect(page.getByText('Removed “Tobins” from “Jig Set”')).toBeVisible();
	await expect(children(page)).toHaveCount(2);
	await page.getByRole('button', { name: 'Undo' }).click();
	await expect.poll(() => childNames(page)).toEqual(order);
	await related(page).getByRole('button', { name: 'Remove Tobins from Jig Set' }).click();
	await expect(children(page)).toHaveCount(2);

	// Each entry links to its piece, which shows where it's part of.
	await related(page).getByRole('link', { name: 'Banish Misfortune' }).click();
	await expect(heading(page)).toHaveText('Banish Misfortune');
	await expect(related(page).getByRole('link', { name: 'Jig Set' })).toBeVisible();

	// Adding the set under its own tune would make a loop: warned, and not added on "Don’t add".
	await related(page).getByRole('button', { name: '+ Add Part' }).click();
	const parts = related(page).getByRole('group', { name: 'Add Part' });
	await parts.getByRole('searchbox').fill('Jig Set');
	await parts.getByRole('button', { name: 'Add Jig Set' }).click();
	await expect(parts.getByRole('alert')).toContainText('makes a loop');
	await parts.getByRole('button', { name: 'Don’t add' }).click();
	await parts.getByRole('button', { name: 'Cancel' }).click();
	await expect(children(page)).toHaveCount(0);

	// The removed tune is still in the library.
	await backToList(page, info);
	await expect(card(page, 'Tobins')).toBeVisible();
	await expect(cards(page)).toHaveCount(3);
});

test('practicing a set shows on its tunes, via the set', async ({ page }, info) => {
	await addTune(page, info, { title: 'The Kesh' });
	await addPiece(page, info, 'Kesh Set', 'Set');
	await addChild(page, 'Add Tune', 'The Kesh');
	await expect(children(page)).toHaveCount(1);

	await details(page).getByRole('button', { name: 'Practiced ✓' }).click();
	await expect(details(page).getByTestId('last-practiced')).toContainText('1 time');

	await related(page).getByRole('link', { name: 'The Kesh' }).click();
	await expect(heading(page)).toHaveText('The Kesh');
	await expect(details(page).getByTestId('last-practiced')).toContainText(
		'Last practiced just now · 1 time'
	);
	const history = page.getByRole('region', { name: 'Practice history' });
	await expect(history.getByRole('listitem')).toHaveCount(1);
	await expect(history.getByRole('listitem').first()).toContainText('via Kesh Set');

	await backToList(page, info);
	await expect(card(page, 'The Kesh').getByTestId('last-practiced')).toHaveText(
		'Last practiced just now'
	);
});

test('a part inherits skill and key from its tune until it has its own', async ({ page }, info) => {
	await addTune(page, info, { title: 'Drowsy Maggie', skill: 3, key: 'Edor' });
	await openPiece(page, 'Drowsy Maggie');
	await addChild(page, 'Add Part', 'A part', true);
	await related(page).getByRole('link', { name: 'A part' }).click();
	await expect(heading(page)).toHaveText('A part');

	const key = page.getByTestId('key');
	await expect(key).toContainText('E dor');
	await expect(key).toContainText('from Drowsy Maggie');
	const skill = page.getByRole('slider', { name: 'Skill' });
	await expect(skill).toHaveValue('3');
	await expect(skill).toHaveAttribute('aria-valuetext', '3 · Getting there, from Drowsy Maggie');

	// Its own values win.
	await skill.fill('5');
	await expect(skill).toHaveAttribute('aria-valuetext', '5 · Amazing');
	await page.getByRole('button', { name: 'Edit', exact: true }).click();
	const dialog = page.getByRole('dialog');
	await expect(dialog.getByText('Uses E dor from Drowsy Maggie until you set one.')).toBeVisible();
	await dialog.getByLabel('Key as text').fill('D');
	await dialog.getByRole('button', { name: 'Done' }).click();
	await expect(key).toHaveText('D maj');

	// …and can go back to inheriting.
	await page.getByRole('button', { name: 'Use Drowsy Maggie’s' }).click();
	await expect(skill).toHaveAttribute('aria-valuetext', '3 · Getting there, from Drowsy Maggie');
	await page.getByRole('button', { name: 'Edit', exact: true }).click();
	await dialog.getByRole('button', { name: 'Use Drowsy Maggie’s key (E dor)' }).click();
	await dialog.getByRole('button', { name: 'Done' }).click();
	await expect(key).toContainText('from Drowsy Maggie');

	// The tune's own values don't change.
	await related(page).getByRole('link', { name: 'Drowsy Maggie' }).click();
	await expect(page.getByTestId('key')).toHaveText('E dor');
	await expect(page.getByRole('slider', { name: 'Skill' })).toHaveValue('3');
});

test('splits two parts from a recording and plays one', async ({ page }, info) => {
	await addTune(page, info, { title: 'Split Reel' });
	await openPiece(page, 'Split Reel');
	await page
		.getByLabel('Upload a file')
		.setInputFiles({ name: 'split-take.wav', mimeType: 'audio/wav', buffer: wav(6) });
	await expect(page.getByTestId('clip')).toHaveCount(1);

	await related(page).getByRole('button', { name: 'Split Part' }).click();
	const dialog = page.getByRole('dialog', { name: 'Split Part' });
	await expect(dialog.getByText('of 0:06')).toBeVisible();
	await dialog.getByLabel('Name of the new part').fill('A part');
	const end = dialog.getByLabel('End', { exact: true });
	await end.fill('0:02');
	await end.press('Tab');
	await dialog.getByRole('button', { name: 'Split off Part' }).click();
	await expect(dialog.getByRole('status')).toHaveText('Split off “A part” (0:00–0:02).');

	// The next region starts where the last one ended.
	await dialog.getByRole('button', { name: 'Split another' }).click();
	await expect(dialog.getByText('of 0:06')).toBeVisible();
	await expect(dialog.getByLabel('Start', { exact: true })).toHaveValue('0:02.0');
	await dialog.getByLabel('Name of the new part').fill('B part');
	await end.fill('0:04');
	await end.press('Tab');
	await dialog.getByRole('button', { name: 'Split off Part' }).click();
	await expect(dialog.getByRole('status')).toHaveText('Split off “B part” (0:02–0:04).');
	await dialog.getByRole('button', { name: 'Done' }).click();
	await expect(dialog).toBeHidden();

	await expect.poll(() => childNames(page)).toEqual(['A part', 'B part']);
	// The tune keeps its whole recording.
	await expect(page.getByTestId('clip-trim')).toBeHidden();

	await related(page).getByRole('link', { name: 'B part' }).click();
	await expect(heading(page)).toHaveText('B part');
	const clip = page.getByRole('listitem', { name: 'split-take' });
	await expect(clip.getByTestId('clip-trim')).toHaveText('0:02–0:04');
	await clip.getByRole('button', { name: 'Play split-take' }).click();
	await expect(player(page)).toHaveAttribute('data-start', '2.00');
	await expect(player(page)).toHaveAttribute('data-end', '4.00');
	await expect
		.poll(async () => Number(await player(page).getAttribute('data-time')))
		.toBeGreaterThan(2.2);

	// A split with no recording makes a blank part.
	await related(page).getByRole('button', { name: 'Split Part' }).click();
	const blank = page.getByRole('dialog', { name: 'Split Part' });
	await blank.getByLabel('Recording').selectOption({ label: 'No recording (blank part)' });
	await blank.getByLabel('Name of the new part').fill('Turn');
	await blank.getByRole('button', { name: 'Add blank Part' }).click();
	await expect(children(page)).toHaveCount(1);
	await expect(related(page).getByRole('link', { name: 'Turn' })).toBeVisible();
});

test('merges two pieces from the menu, and undoes it', async ({ page }, info) => {
	await addTune(page, info, { title: 'Merry Blacksmith', tags: ['Reel'] });
	await addTune(page, info, { title: 'Blacksmith Reel', tags: ['Session'] });
	await expect(cards(page)).toHaveCount(2);

	await card(page, 'Merry Blacksmith')
		.getByRole('button', { name: 'More actions for Merry Blacksmith' })
		.click();
	await page.getByRole('menuitem', { name: 'Merge with…' }).click();
	const picker = page.getByRole('dialog', { name: 'Merge “Merry Blacksmith” with…' });
	await picker.getByRole('searchbox').fill('Blacksmith');
	// The piece itself isn't offered.
	await expect(picker.getByRole('button', { name: /^Merge with/ })).toHaveCount(1);
	await picker.getByRole('button', { name: 'Merge with Blacksmith Reel' }).click();

	const merge = page.getByRole('dialog', { name: 'Merge 2 pieces' });
	await expect(
		merge.getByRole('group', { name: 'Keep' }).getByRole('radio', { name: /^Merry Blacksmith/ })
	).toBeChecked();
	await merge.getByRole('button', { name: 'Merge' }).click();
	await expect(page.getByText('Merged 2 pieces into “Merry Blacksmith”')).toBeVisible();
	await expect(heading(page)).toHaveText('Merry Blacksmith');
	await backToList(page, info);
	await expect(cards(page)).toHaveCount(1);
	await expect(card(page, 'Merry Blacksmith').getByRole('listitem')).toHaveText([
		'Reel',
		'Session'
	]);

	await page.getByRole('button', { name: 'Undo' }).click();
	await expect(cards(page)).toHaveCount(2);
	await expect(card(page, 'Merry Blacksmith').getByRole('listitem')).toHaveText(['Reel']);
	await expect(card(page, 'Blacksmith Reel').getByRole('listitem')).toHaveText(['Session']);

	// The undo is in the doc, so it survives a reload.
	await page.reload();
	await expect(cards(page)).toHaveCount(2);
});
