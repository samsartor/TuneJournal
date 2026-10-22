// Web Share Target (PLAN.md §7): Android's share sheet POSTs files or links to the installed PWA
// (see `share_target` in static/manifest.webmanifest). The service worker catches the POST, keeps
// the files in the audio cache and an inbox entry for each, and 303-redirects to the "Shared
// recording" page, where they're attached to a piece.
//
// Lib-agnostic so it type-checks under both the DOM and WebWorker libs.

import { audioCache, type AudioCache, type InboxItem } from '#lib/audio/cache.ts';
import { newId } from '#lib/domain/id.ts';

/** Must match `share_target.action` in the manifest, relative to the scope. */
export const SHARE_ACTION = 'share-target';
/** Where M0's spike posted; installed apps keep this until their WebAPK updates. */
export const LEGACY_SHARE_ACTION = 'spike/share-target';
/** The page the share lands on. */
export const SHARE_PAGE = 'shared';

export function isShareTarget(request: Request, scope: string): boolean {
	if (request.method !== 'POST') return false;
	const url = request.url.split('?')[0];
	return (
		url === new URL(SHARE_ACTION, scope).href || url === new URL(LEGACY_SHARE_ACTION, scope).href
	);
}

/** Strips a file extension and tidies separators: "2026-10-22_Kesh-jig.m4a" → "2026-10-22 Kesh-jig". */
export function titleFromFileName(name: string): string {
	return name
		.replace(/\.[a-z0-9]{1,5}$/i, '')
		.replace(/[_]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/** MIME type for a shared file, guessing from its name when the sender left it blank. */
export function audioType(file: { type: string; name: string }): string {
	if (file.type && file.type !== 'application/octet-stream') return file.type;
	const ext = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase();
	const byExt: Record<string, string> = {
		m4a: 'audio/mp4',
		mp4: 'audio/mp4',
		aac: 'audio/aac',
		mp3: 'audio/mpeg',
		wav: 'audio/wav',
		ogg: 'audio/ogg',
		oga: 'audio/ogg',
		opus: 'audio/ogg',
		flac: 'audio/flac',
		webm: 'audio/webm'
	};
	return (ext && byExt[ext]) || file.type || 'application/octet-stream';
}

/** A file extension for an audio MIME type, for naming uploads: "audio/mp4" → "m4a". */
export function extensionFor(mime: string): string {
	const sub = /^audio\/(?:x-)?([\w.+-]+)/.exec(mime)?.[1]?.toLowerCase();
	const byType: Record<string, string> = {
		mp4: 'm4a',
		m4a: 'm4a',
		mpeg: 'mp3',
		mp3: 'mp3',
		wav: 'wav',
		wave: 'wav',
		ogg: 'ogg',
		opus: 'opus',
		webm: 'webm',
		flac: 'flac',
		aac: 'aac'
	};
	return (sub && byType[sub]) || 'bin';
}

const text = (form: FormData, key: string) => {
	const v = form.get(key);
	return typeof v === 'string' && v.trim() ? v.trim() : undefined;
};

/** Stores what was shared and returns the inbox items created. */
export async function receiveShare(
	form: FormData,
	cache: AudioCache = audioCache,
	now: number = Date.now()
): Promise<InboxItem[]> {
	const items: InboxItem[] = [];
	for (const entry of form.getAll('audio')) {
		if (typeof entry === 'string') continue;
		const id = newId();
		const type = audioType(entry);
		const blob = type === entry.type ? entry : new Blob([entry], { type });
		// The only copy so far, so keep it offline.
		await cache.put(id, blob, { keep: true });
		const item: InboxItem = {
			id,
			receivedAt: now,
			kind: 'file',
			name: entry.name,
			mime: type,
			size: entry.size
		};
		const title = text(form, 'title');
		if (title) item.title = title;
		await cache.addToInbox(item);
		items.push(item);
	}
	// "Share → Link" (Recorder, YouTube, Spotify…) sends text or a URL instead of a file.
	if (items.length === 0) {
		const item: InboxItem = { id: newId(), receivedAt: now, kind: 'text' };
		for (const key of ['title', 'text', 'url'] as const) {
			const value = text(form, key);
			if (value) item[key] = value;
		}
		if (item.title || item.text || item.url) {
			await cache.addToInbox(item);
			items.push(item);
		}
	}
	return items;
}

export async function handleShareTarget(request: Request, scope: string): Promise<Response> {
	const page = new URL(SHARE_PAGE, scope);
	try {
		const items = await receiveShare(await request.formData());
		page.searchParams.set('received', String(items.length));
	} catch (e) {
		page.searchParams.set('error', String(e));
	}
	// 303 turns the POST into a GET navigation, which the app shell then serves.
	return Response.redirect(page.href, 303);
}
