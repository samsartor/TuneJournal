import { describe, expect, it } from 'vitest';
import type { AudioCache, InboxItem } from '#lib/audio/cache.ts';
import {
	audioType,
	extensionFor,
	isShareTarget,
	receiveShare,
	titleFromFileName
} from './share-target';

function fakeCache() {
	const blobs = new Map<string, { blob: Blob; keep?: boolean }>();
	const inbox: InboxItem[] = [];
	const cache = {
		put: async (id: string, blob: Blob, options: { keep?: boolean } = {}) => {
			blobs.set(id, { blob, keep: options.keep });
		},
		addToInbox: async (item: InboxItem) => void inbox.push(item)
	} as unknown as AudioCache;
	return { cache, blobs, inbox };
}

const SCOPE = 'https://app.example/';

describe('share target', () => {
	it('recognises POSTs to the action, including the spike’s old one', () => {
		const post = (url: string) => new Request(url, { method: 'POST' });
		expect(isShareTarget(post(`${SCOPE}share-target`), SCOPE)).toBe(true);
		expect(isShareTarget(post(`${SCOPE}share-target?x=1`), SCOPE)).toBe(true);
		expect(isShareTarget(post(`${SCOPE}spike/share-target`), SCOPE)).toBe(true);
		expect(isShareTarget(new Request(`${SCOPE}share-target`), SCOPE)).toBe(false);
		expect(isShareTarget(post(`${SCOPE}other`), SCOPE)).toBe(false);
	});

	it('keeps shared files offline and lists them in the inbox', async () => {
		const { cache, blobs, inbox } = fakeCache();
		const form = new FormData();
		form.append('audio', new File(['abc'], 'Kesh jig.m4a', { type: '' }));
		form.append('title', 'Recorder');
		const items = await receiveShare(form, cache, 42);
		expect(items).toHaveLength(1);
		expect(inbox).toEqual(items);
		expect(items[0]).toMatchObject({
			kind: 'file',
			name: 'Kesh jig.m4a',
			mime: 'audio/mp4',
			size: 3,
			title: 'Recorder',
			receivedAt: 42
		});
		const stored = blobs.get(items[0].id)!;
		expect(stored.keep).toBe(true);
		expect(stored.blob.type).toBe('audio/mp4');
	});

	it('keeps a shared link as a text item', async () => {
		const { cache, blobs, inbox } = fakeCache();
		const form = new FormData();
		form.append('title', 'A tune');
		form.append('text', 'Listen https://youtu.be/dQw4w9WgXcQ');
		form.append('url', '');
		await receiveShare(form, cache, 1);
		expect(blobs.size).toBe(0);
		expect(inbox).toMatchObject([
			{ kind: 'text', title: 'A tune', text: 'Listen https://youtu.be/dQw4w9WgXcQ' }
		]);
		expect('url' in inbox[0]).toBe(false);
	});

	it('ignores an empty share', async () => {
		const { cache, inbox } = fakeCache();
		await receiveShare(new FormData(), cache);
		expect(inbox).toEqual([]);
	});

	it('names and types', () => {
		expect(titleFromFileName('2026-10-22_Kesh_jig.m4a')).toBe('2026-10-22 Kesh jig');
		expect(titleFromFileName('no extension')).toBe('no extension');
		expect(audioType({ type: 'audio/x-m4a', name: 'a.m4a' })).toBe('audio/x-m4a');
		expect(audioType({ type: 'application/octet-stream', name: 'a.MP3' })).toBe('audio/mpeg');
		expect(audioType({ type: '', name: 'mystery' })).toBe('application/octet-stream');
		expect(extensionFor('audio/mp4')).toBe('m4a');
		expect(extensionFor('audio/x-wav')).toBe('wav');
		expect(extensionFor('audio/mpeg')).toBe('mp3');
		expect(extensionFor('video/mp4')).toBe('bin');
	});
});
