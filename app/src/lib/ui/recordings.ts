// Adding, backing up and removing recordings: the glue between the domain ops, the audio cache,
// Drive and the toasts. Each source type's flow is described in PLAN.md §14 "Decided during M4".

import type { InboxItem } from '#lib/audio/cache.ts';
import { player } from '#lib/audio/player.svelte.ts';
import { newId } from '#lib/domain/id.ts';
import { DRIVE_ASSET, driveFileUrl, isLocalOnly } from '#lib/domain/providers.ts';
import {
	addRecording,
	removeClip,
	restoreClip,
	updateSource,
	type NewSource
} from '#lib/domain/recordings.ts';
import { tuneSourceId } from '#lib/domain/thesession.ts';
import type { ClipId, PieceId, Source, SourceId } from '#lib/domain/types.ts';
import { findUrl, detectLink, type DetectedLink } from '#lib/integrations/links.ts';
import { audioType, extensionFor, titleFromFileName } from '#lib/integrations/share-target.ts';
import { audioCache } from '#lib/audio/cache.ts';
import { audioFiles } from '#lib/store/audio.svelte.ts';
import { gdrive } from '#lib/store/gdrive.svelte.ts';
import { library } from '#lib/store/library.svelte.ts';
import { ui } from './state.svelte.ts';

/** The media duration of an audio blob, if the browser can tell. */
export function probeDuration(blob: Blob, timeoutMs = 5000): Promise<number | undefined> {
	return new Promise((resolve) => {
		const audio = new Audio();
		const url = URL.createObjectURL(blob);
		const done = (value?: number) => {
			clearTimeout(timer);
			audio.removeAttribute('src');
			URL.revokeObjectURL(url);
			resolve(value && Number.isFinite(value) ? value : undefined);
		};
		const timer = setTimeout(() => done(), timeoutMs);
		audio.preload = 'metadata';
		audio.onloadedmetadata = () => done(audio.duration);
		audio.onerror = () => done();
		audio.src = url;
	});
}

function message(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

/** Saves the source's measured duration, if it doesn't have one. */
async function fillDuration(sourceId: SourceId, blob: Blob) {
	const duration = await probeDuration(blob);
	if (!duration) return;
	library.change((d) => {
		if (d.sources[sourceId] && d.sources[sourceId].durationSec === undefined) {
			updateSource(d, sourceId, { durationSec: duration });
		}
	});
}

/**
 * Upload: the file goes into the audio cache, kept offline since it's the only copy, and the doc
 * gets an `upload` Source with the same id. If Drive is connected it's backed up in the background.
 */
export async function addUpload(
	pieceId: PieceId,
	file: File | Blob,
	options: { id?: string; name?: string; title?: string } = {}
): Promise<ClipId> {
	const id = (options.id ?? newId()) as SourceId;
	const name = options.name ?? (file instanceof File ? file.name : 'recording');
	const type = audioType({ type: file.type, name });
	const blob = file.type === type ? file : new Blob([file], { type });
	if (!(await audioCache.has(id))) await audioFiles.put(id, blob, { keep: true });
	else await audioFiles.refresh();
	const source: NewSource = {
		id,
		provider: 'upload',
		url: '',
		title: options.title?.trim() || titleFromFileName(name) || undefined,
		mime: type
	};
	const { clipId } = library.change((d) => addRecording(d, pieceId, source));
	void fillDuration(id, blob);
	if (gdrive.configured && gdrive.connected) void backUp(id, { quiet: true });
	return clipId;
}

/**
 * Copies an upload to the user's Drive (`TuneJournal/`), so other devices can fetch it. The
 * source stays `upload`; the Drive file id goes in `assetKey` and its link in `url`.
 */
export async function backUp(sourceId: SourceId, { quiet = false } = {}): Promise<boolean> {
	const source = library.doc?.sources[sourceId];
	if (!source || !isLocalOnly(source)) return true;
	try {
		const blob = await audioCache.get(sourceId);
		if (!blob) throw new Error('The recording isn’t on this device.');
		const name = `${source.title ?? 'Recording'}.${extensionFor(blob.type || source.mime || '')}`;
		const file = await gdrive.upload(blob, name);
		library.change((d) =>
			updateSource(d, sourceId, {
				assetKey: `${DRIVE_ASSET}${file.id}`,
				url: driveFileUrl(file.id)
			})
		);
		if (!quiet) ui.showToast('Backed up to Google Drive');
		return true;
	} catch (e) {
		console.warn('Backup to Drive failed', e);
		ui.showToast(`Couldn’t back up to Google Drive: ${message(e)}`);
		return false;
	}
}

/** Google Drive: pick a file, add a `gdrive` Source, and download it into the cache. */
export async function addFromDrive(pieceId: PieceId): Promise<ClipId | undefined> {
	let picked;
	try {
		picked = await gdrive.pick();
	} catch (e) {
		ui.showToast(`Google Drive: ${message(e)}`);
		return undefined;
	}
	if (!picked) return undefined;
	const source: NewSource = {
		provider: 'gdrive',
		url: driveFileUrl(picked.id),
		externalId: picked.id,
		title: titleFromFileName(picked.name),
		mime: picked.mimeType
	};
	if (picked.durationSec) source.durationSec = picked.durationSec;
	const { clipId, sourceId } = library.change((d) => addRecording(d, pieceId, source));
	const added = library.doc?.sources[sourceId];
	if (added) {
		audioFiles
			.blobFor(added)
			.then((blob) => fillDuration(sourceId, blob))
			.catch((e) => ui.showToast(`Couldn’t download from Google Drive: ${message(e)}`));
	}
	return clipId;
}

/** Saves a cached recording's bytes as a file (for uploads that aren't anywhere else yet). */
export async function downloadRecording(source: Source, title: string) {
	try {
		const blob = await audioCache.get(source.id);
		if (!blob) throw new Error('The recording isn’t on this device.');
		const type = blob.type || source.mime || '';
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `${title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'recording'}.${extensionFor(type)}`;
		a.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	} catch (e) {
		ui.showToast(`Couldn’t save the file: ${message(e)}`);
	}
}

/** Turns a detected link into a Source to add. thesession links share the M3 link's id. */
export function sourceFromLink(link: DetectedLink): NewSource {
	const source: NewSource = { provider: link.provider, url: link.url };
	if (link.externalId) source.externalId = link.externalId;
	if (link.provider === 'thesession' && link.externalId && /^\d+$/.test(link.externalId)) {
		source.id = tuneSourceId(Number(link.externalId));
	}
	return source;
}

/** YouTube, Spotify, Drive or any other link. A YouTube `t=` becomes the clip's start. */
export function addLink(pieceId: PieceId, link: DetectedLink, title?: string): ClipId {
	const fields = { title: title?.trim() || undefined, start: link.start };
	return library.change((d) => addRecording(d, pieceId, sourceFromLink(link), fields)).clipId;
}

/** Removes a clip, with an Undo toast. Its Source and any cached audio stay. */
export function removeRecording(pieceId: PieceId, clipId: ClipId) {
	if (player.isCurrent(pieceId, clipId)) player.close();
	const removed = library.change((d) => removeClip(d, pieceId, clipId));
	if (!removed) return;
	ui.showToast('Recording removed', {
		label: 'Undo',
		run: () => library.change((d) => restoreClip(d, pieceId, removed))
	});
}

/** The link in a shared text item, if any. */
export function sharedLink(item: InboxItem): DetectedLink | undefined {
	const candidates = [item.url, item.text && findUrl(item.text), item.title && findUrl(item.title)];
	for (const c of candidates) {
		const link = c ? detectLink(c) : undefined;
		if (link) return link;
	}
	return undefined;
}

/** Attaches a shared file or link to a piece and takes it out of the inbox. */
export async function attachShared(item: InboxItem, pieceId: PieceId, title?: string) {
	if (item.kind === 'file') {
		const blob = await audioCache.get(item.id);
		if (!blob) throw new Error('The shared file is gone from this device.');
		await addUpload(pieceId, blob, {
			id: item.id,
			name: item.name ?? 'shared recording',
			title: title ?? item.title
		});
		// Recorder shares are uploads too: the provider records where the bytes came from (us).
	} else {
		const link = sharedLink(item);
		if (!link) throw new Error('There’s no link in what was shared.');
		addLink(pieceId, link, title);
	}
	await audioCache.removeFromInbox(item.id);
}
