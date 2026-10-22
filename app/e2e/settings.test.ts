import { expect, test } from '@playwright/test';
import { addTune, card, open } from './helpers';

test('exports the library and merges a backup back in', async ({ page }, info) => {
	await open(page);
	await addTune(page, info, { title: 'The Silver Spear', tags: ['Reel'] });

	await page.getByRole('link', { name: 'Settings' }).click();
	await expect(page.getByTestId('library-url')).toHaveText(/^automerge:/);
	await expect(page.getByText('1 piece')).toBeVisible();

	const [binary] = await Promise.all([
		page.waitForEvent('download'),
		page.getByRole('button', { name: 'Export .automerge' }).click()
	]);
	expect(binary.suggestedFilename()).toMatch(/^tunejournal-\d{4}-\d\d-\d\d\.automerge$/);
	const backup = info.outputPath('backup.automerge');
	await binary.saveAs(backup);

	const [json] = await Promise.all([
		page.waitForEvent('download'),
		page.getByRole('button', { name: 'Export JSON' }).click()
	]);
	const snapshot = JSON.parse(await readDownload(json));
	expect(Object.values(snapshot.pieces)).toMatchObject([{ title: 'The Silver Spear' }]);

	// Importing asks first, then merges without duplicating anything.
	await page.getByLabel('Choose a backup file').setInputFiles(backup);
	await expect(page.getByText(/Merge .*backup\.automerge.* into this library\?/)).toBeVisible();
	await page.getByRole('button', { name: 'Merge into library' }).click();
	await expect(page.getByText('Merged the backup into this library.')).toBeVisible();
	await expect(page.getByText('1 piece')).toBeVisible();

	await page.getByRole('link', { name: '← All pieces' }).click();
	await expect(card(page, 'The Silver Spear')).toBeVisible();
});

async function readDownload(download: import('@playwright/test').Download) {
	const chunks: Buffer[] = [];
	for await (const chunk of await download.createReadStream()) chunks.push(chunk as Buffer);
	return Buffer.concat(chunks).toString('utf8');
}
