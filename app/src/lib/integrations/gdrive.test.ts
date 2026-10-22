import { describe, expect, it, vi } from 'vitest';
import {
	APP_FOLDER,
	DEVICE_CONFIG_KEY,
	DriveClient,
	DriveError,
	FOLDER_MIME,
	createFolderRequest,
	downloadRequest,
	driveFileUrl,
	configProblems,
	findFolderRequest,
	isConfigured,
	mergeConfig,
	quoteQuery,
	readDeviceConfig,
	writeDeviceConfig,
	uploadRequest,
	type TokenSource
} from './gdrive';

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function tokens(): TokenSource & { calls: boolean[] } {
	let n = 0;
	const calls: boolean[] = [];
	return {
		calls,
		token: async ({ renew = false } = {}) => {
			calls.push(renew);
			if (renew || n === 0) n++;
			return `t${n}`;
		}
	};
}

const auth = (init: RequestInit | undefined) =>
	(init?.headers as Record<string, string>).Authorization;

describe('request building', () => {
	it('config', () => {
		expect(isConfigured({ clientId: 'a', apiKey: 'b', appId: 'c' })).toBe(true);
		expect(isConfigured({ clientId: 'a', apiKey: '', appId: 'c' })).toBe(false);
		expect(isConfigured({})).toBe(false);
	});

	it('download uses alt=media', () => {
		expect(downloadRequest('a/b').url).toBe(
			'https://www.googleapis.com/drive/v3/files/a%2Fb?alt=media'
		);
		expect(driveFileUrl('F1')).toBe('https://drive.google.com/file/d/F1/view');
	});

	it('folder lookup quotes the name', () => {
		expect(quoteQuery("it's")).toBe("'it\\'s'");
		const url = new URL(findFolderRequest().url);
		expect(url.searchParams.get('q')).toBe(
			`name = 'TuneJournal' and mimeType = '${FOLDER_MIME}' and trashed = false`
		);
		expect(url.searchParams.get('fields')).toBe('files(id,name)');
		const create = createFolderRequest();
		expect(create.init.method).toBe('POST');
		expect(JSON.parse(create.init.body as string)).toEqual({
			name: APP_FOLDER,
			mimeType: FOLDER_MIME
		});
	});

	it('upload is multipart with metadata first', async () => {
		const file = new Blob(['abc'], { type: 'audio/mp4' });
		const { url, init } = uploadRequest('FOLDER', file, 'take.m4a');
		expect(url).toMatch(
			/^https:\/\/www\.googleapis\.com\/upload\/drive\/v3\/files\?uploadType=multipart/
		);
		const form = init.body as FormData;
		expect([...form.keys()]).toEqual(['metadata', 'file']);
		const metadata = JSON.parse(await (form.get('metadata') as Blob).text());
		expect(metadata).toEqual({ name: 'take.m4a', parents: ['FOLDER'], mimeType: 'audio/mp4' });
		expect(await (form.get('file') as Blob).text()).toBe('abc');
	});
});

describe('DriveClient', () => {
	it('downloads with the bearer token', async () => {
		const fetcher = vi.fn<typeof fetch>(async () => new Response(new Blob(['audio'])));
		const client = new DriveClient(tokens(), fetcher);
		const blob = await client.download('F1');
		expect(await blob.text()).toBe('audio');
		expect(fetcher.mock.calls[0][0]).toBe(downloadRequest('F1').url);
		expect(auth(fetcher.mock.calls[0][1])).toBe('Bearer t1');
	});

	it('re-authenticates once when the token has expired', async () => {
		const t = tokens();
		const fetcher = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(json({ error: { message: 'Invalid Credentials' } }, 401))
			.mockResolvedValueOnce(new Response('ok'));
		const client = new DriveClient(t, fetcher);
		await client.download('F1');
		expect(t.calls).toEqual([false, true]);
		expect(auth(fetcher.mock.calls[1][1])).toBe('Bearer t2');
	});

	it('gives up after a second 401, and reports other errors', async () => {
		const fetcher = vi.fn<typeof fetch>(async () => json({}, 401));
		await expect(new DriveClient(tokens(), fetcher).download('F1')).rejects.toBeInstanceOf(
			DriveError
		);
		expect(fetcher).toHaveBeenCalledTimes(2);

		const notFound = vi.fn<typeof fetch>(async () =>
			json({ error: { message: 'File not found: F1.' } }, 404)
		);
		await expect(new DriveClient(tokens(), notFound).download('F1')).rejects.toMatchObject({
			status: 404,
			message: 'Google Drive: 404 File not found: F1.'
		});
	});

	it('finds or creates the app folder once, then uploads into it', async () => {
		const fetcher = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(json({ files: [] }))
			.mockResolvedValueOnce(json({ id: 'NEWFOLDER' }))
			.mockResolvedValueOnce(json({ id: 'FILE1', name: 'a.m4a' }))
			.mockResolvedValueOnce(json({ id: 'FILE2', name: 'b.m4a' }));
		const client = new DriveClient(tokens(), fetcher);
		await expect(client.upload(new Blob(['a']), 'a.m4a')).resolves.toMatchObject({ id: 'FILE1' });
		await expect(client.upload(new Blob(['b']), 'b.m4a')).resolves.toMatchObject({ id: 'FILE2' });
		expect(fetcher).toHaveBeenCalledTimes(4);
		expect(fetcher.mock.calls[1][1]?.method).toBe('POST');
		const metadata = JSON.parse(
			await ((fetcher.mock.calls[3][1]?.body as FormData).get('metadata') as Blob).text()
		);
		expect(metadata.parents).toEqual(['NEWFOLDER']);
	});

	it('reuses an existing folder, and retries the lookup after a failure', async () => {
		const fetcher = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(json({}, 500))
			.mockResolvedValueOnce(json({ files: [{ id: 'OLD' }] }));
		const client = new DriveClient(tokens(), fetcher);
		await expect(client.ensureFolder()).rejects.toThrow(DriveError);
		await expect(client.ensureFolder()).resolves.toBe('OLD');
	});
});

describe('device-local Drive settings', () => {
	function memoryStorage(): Storage {
		const data = new Map<string, string>();
		return {
			get length() {
				return data.size;
			},
			clear: () => data.clear(),
			getItem: (k) => data.get(k) ?? null,
			key: (i) => [...data.keys()][i] ?? null,
			removeItem: (k) => void data.delete(k),
			setItem: (k, v) => void data.set(k, String(v))
		};
	}

	const BUILD = { clientId: 'build.apps.googleusercontent.com', apiKey: 'AIzaBuild', appId: '111' };

	it('saves trimmed values on the device and reads them back', () => {
		const storage = memoryStorage();
		expect(readDeviceConfig(storage)).toEqual({});
		const saved = writeDeviceConfig(
			{ clientId: '  mine.apps.googleusercontent.com ', apiKey: '', appId: '222' },
			storage
		);
		expect(saved).toEqual({ clientId: 'mine.apps.googleusercontent.com', appId: '222' });
		expect(readDeviceConfig(storage)).toEqual(saved);
		expect(JSON.parse(storage.getItem(DEVICE_CONFIG_KEY)!)).toEqual(saved);
		// All blank forgets them.
		writeDeviceConfig({}, storage);
		expect(storage.getItem(DEVICE_CONFIG_KEY)).toBeNull();
		// Junk in storage is ignored.
		storage.setItem(DEVICE_CONFIG_KEY, '{not json');
		expect(readDeviceConfig(storage)).toEqual({});
	});

	it('device values take precedence over the build’s, field by field', () => {
		expect(mergeConfig({ appId: '222' }, BUILD)).toEqual({ ...BUILD, appId: '222' });
		expect(mergeConfig({}, BUILD)).toEqual(BUILD);
		expect(isConfigured(mergeConfig({ clientId: 'x' }, {}))).toBe(false);
		expect(isConfigured(mergeConfig({ clientId: 'x', apiKey: 'y', appId: '1' }, {}))).toBe(true);
	});

	it('flags likely typos', () => {
		expect(configProblems(BUILD)).toEqual([]);
		expect(configProblems({ clientId: 'abc', appId: 'my-project', apiKey: 'AI za' })).toHaveLength(
			3
		);
	});
});
