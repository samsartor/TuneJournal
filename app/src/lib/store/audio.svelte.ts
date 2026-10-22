// The audio cache for the UI: which sources have bytes on this device, "Keep offline", and getting
// the bytes for a source (from the cache, else from Drive or the source's URL).

import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { audioCache, type AudioEntry, type Usage } from '#lib/audio/cache.ts';
import { driveFileId, isCacheable } from '#lib/domain/providers.ts';
import type { Source } from '#lib/domain/types.ts';
import { gdrive } from './gdrive.svelte.ts';

export class NotOnThisDeviceError extends Error {
	constructor() {
		super(
			'This recording is only on the device it was added from. Back it up to Google Drive there to play it here.'
		);
		this.name = 'NotOnThisDeviceError';
	}
}

class AudioFiles {
	readonly entries = new SvelteMap<string, AudioEntry>();
	/** Sources being downloaded right now. */
	readonly downloading = new SvelteSet<string>();
	usage = $state<Usage>();
	loaded = $state(false);

	#inFlight = new Map<string, Promise<Blob>>();

	async refresh() {
		try {
			const entries = await audioCache.entries();
			this.entries.clear();
			for (const e of entries) this.entries.set(e.id, e);
			this.usage = await audioCache.usage();
		} catch (e) {
			console.warn('Couldn’t read the audio cache', e);
		} finally {
			this.loaded = true;
		}
	}

	async #reload(id: string) {
		const entry = await audioCache.entry(id);
		if (entry) this.entries.set(id, entry);
		else this.entries.delete(id);
		this.usage = await audioCache.usage();
	}

	cached(id: string): boolean {
		return !!this.entries.get(id)?.backend;
	}

	kept(id: string): boolean {
		return !!this.entries.get(id)?.keep;
	}

	async put(id: string, blob: Blob, options: { keep?: boolean } = {}) {
		await audioCache.put(id, blob, options);
		await this.#reload(id);
	}

	/** The bytes for a source: cached, else downloaded (and cached). */
	async blobFor(source: Source): Promise<Blob> {
		const cached = await audioCache.get(source.id);
		if (cached) return cached;
		let pending = this.#inFlight.get(source.id);
		if (!pending) {
			pending = this.#download(source).finally(() => {
				this.#inFlight.delete(source.id);
				this.downloading.delete(source.id);
			});
			this.#inFlight.set(source.id, pending);
			this.downloading.add(source.id);
		}
		return pending;
	}

	async #download(source: Source): Promise<Blob> {
		const fileId = driveFileId(source);
		let blob: Blob;
		if (fileId && gdrive.configured) {
			blob = await gdrive.download(fileId);
		} else if (source.provider === 'url') {
			const res = await fetch(source.url);
			if (!res.ok) throw new Error(`Download failed: ${res.status}`);
			blob = await res.blob();
		} else if (fileId) {
			throw new Error('Google Drive isn’t set up in this copy of the app.');
		} else {
			throw new NotOnThisDeviceError();
		}
		// Drive sometimes serves audio as octet-stream; the Source remembers the real type.
		if (source.mime && (!blob.type || blob.type === 'application/octet-stream')) {
			blob = new Blob([blob], { type: source.mime });
		}
		await this.put(source.id, blob);
		return blob;
	}

	/** Device-local "Keep offline". Turning it on downloads the bytes now if they're missing. */
	async setKeep(source: Source, keep: boolean) {
		await audioCache.setKeep(source.id, keep);
		await this.#reload(source.id);
		if (keep && isCacheable(source) && !this.cached(source.id)) {
			try {
				await this.blobFor(source);
			} catch (e) {
				await audioCache.setKeep(source.id, false);
				await this.#reload(source.id);
				throw e;
			}
		}
	}

	/** Drops downloaded bytes not kept offline. `protect` keeps others (local-only uploads). */
	async clearUnkept(protect: (id: string) => boolean): Promise<number> {
		const freed = await audioCache.clearUnkept(protect);
		await this.refresh();
		return freed;
	}

	async remove(id: string) {
		await audioCache.delete(id);
		await this.#reload(id);
	}
}

export const audioFiles = new AudioFiles();
