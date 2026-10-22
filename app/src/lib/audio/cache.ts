// The audio cache (PLAN.md §2): recording bytes on this device, keyed by source id, never synced.
// Bytes go to OPFS, or to IndexedDB where OPFS writes aren't available (Safari service workers lack
// createWritable). Metadata (type, size, "keep offline") lives in IndexedDB rather than an OPFS
// sidecar file, so concurrent writers (a page and the service worker) can't clobber each other.
//
// Shared by the pages and the service worker, so it only touches `navigator.storage` and
// `indexedDB`, and type-checks under both the DOM and WebWorker libs.
//
// It also holds the share-target inbox: files and links shared into the app that haven't been
// attached to a piece yet.

export type Backend = 'opfs' | 'idb';

export interface AudioEntry {
	/** The source id. */
	id: string;
	mime: string;
	size: number;
	storedAt: number;
	/** Where the bytes are; absent when only the "keep offline" wish is recorded. */
	backend?: Backend;
	/** Device-local "Keep offline": never dropped by "Clear downloads". */
	keep: boolean;
}

export interface InboxItem {
	/** Also the audio cache id of a shared file, and the source id once it's attached. */
	id: string;
	receivedAt: number;
	/** A shared file (bytes in the cache under `id`) or shared text/link. */
	kind: 'file' | 'text';
	name?: string;
	mime?: string;
	size?: number;
	title?: string;
	text?: string;
	url?: string;
}

export interface Usage {
	count: number;
	bytes: number;
	keptCount: number;
	keptBytes: number;
}

const DB_NAME = 'tunejournal-audio';
const DB_VERSION = 1;
const META = 'meta';
const BLOBS = 'blobs';
const INBOX = 'inbox';
const OPFS_DIR = 'audio';

function req<T>(r: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		r.onsuccess = () => resolve(r.result);
		r.onerror = () => reject(r.error);
	});
}

/** OPFS names can't hold `/` and friends; source ids can hold `:`. */
const fileName = (id: string) => encodeURIComponent(id);

export class AudioCache {
	#db?: Promise<IDBDatabase>;

	constructor(private readonly dbName = DB_NAME) {}

	#open(): Promise<IDBDatabase> {
		this.#db ??= new Promise((resolve, reject) => {
			const open = indexedDB.open(this.dbName, DB_VERSION);
			open.onupgradeneeded = () => {
				const db = open.result;
				if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'id' });
				if (!db.objectStoreNames.contains(BLOBS)) db.createObjectStore(BLOBS);
				if (!db.objectStoreNames.contains(INBOX)) db.createObjectStore(INBOX, { keyPath: 'id' });
			};
			open.onsuccess = () => resolve(open.result);
			open.onerror = () => reject(open.error);
		});
		return this.#db;
	}

	async #store(name: string, mode: IDBTransactionMode) {
		return (await this.#open()).transaction(name, mode).objectStore(name);
	}

	static opfsAvailable(): boolean {
		return (
			typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function'
		);
	}

	async #opfsDir(create: boolean) {
		const root = await navigator.storage.getDirectory();
		return root.getDirectoryHandle(OPFS_DIR, { create });
	}

	/** Stores the bytes for a source, replacing any already there. */
	async put(id: string, blob: Blob, options: { keep?: boolean } = {}): Promise<AudioEntry> {
		const previous = await this.entry(id);
		let backend: Backend = 'idb';
		if (AudioCache.opfsAvailable()) {
			try {
				const handle = await (
					await this.#opfsDir(true)
				).getFileHandle(fileName(id), {
					create: true
				});
				if (typeof handle.createWritable === 'function') {
					const writable = await handle.createWritable();
					await writable.write(blob);
					await writable.close();
					backend = 'opfs';
				}
			} catch (e) {
				console.warn('OPFS write failed, falling back to IndexedDB', e);
			}
		}
		if (backend === 'idb') await req((await this.#store(BLOBS, 'readwrite')).put(blob, id));
		else if (previous?.backend === 'idb') {
			await req((await this.#store(BLOBS, 'readwrite')).delete(id));
		}
		const entry: AudioEntry = {
			id,
			mime: blob.type,
			size: blob.size,
			storedAt: Date.now(),
			backend,
			keep: options.keep ?? previous?.keep ?? false
		};
		await req((await this.#store(META, 'readwrite')).put(entry));
		return entry;
	}

	async entry(id: string): Promise<AudioEntry | undefined> {
		return (await req((await this.#store(META, 'readonly')).get(id))) as AudioEntry | undefined;
	}

	async entries(): Promise<AudioEntry[]> {
		return (await req((await this.#store(META, 'readonly')).getAll())) as AudioEntry[];
	}

	async has(id: string): Promise<boolean> {
		return !!(await this.entry(id))?.backend;
	}

	/** The cached bytes for a source, typed with the remembered MIME type. */
	async get(id: string): Promise<Blob | undefined> {
		const entry = await this.entry(id);
		if (!entry?.backend) return undefined;
		try {
			if (entry.backend === 'opfs') {
				const file = await (
					await (await this.#opfsDir(false)).getFileHandle(fileName(id))
				).getFile();
				return new Blob([file], { type: entry.mime });
			}
			const blob = (await req((await this.#store(BLOBS, 'readonly')).get(id))) as Blob | undefined;
			return blob && (blob.type ? blob : new Blob([blob], { type: entry.mime }));
		} catch (e) {
			// The browser evicted the bytes but not the metadata. Forget them.
			console.warn(`Cached audio for ${id} is gone`, e);
			await this.#forgetBytes(entry);
			return undefined;
		}
	}

	/** Device-local "Keep offline". Recorded even before the bytes are downloaded. */
	async setKeep(id: string, keep: boolean): Promise<void> {
		const entry = (await this.entry(id)) ?? { id, mime: '', size: 0, storedAt: Date.now(), keep };
		entry.keep = keep;
		if (!keep && !entry.backend) {
			await req((await this.#store(META, 'readwrite')).delete(id));
			return;
		}
		await req((await this.#store(META, 'readwrite')).put(entry));
	}

	async #removeBytes(entry: AudioEntry) {
		if (entry.backend === 'opfs') {
			try {
				await (await this.#opfsDir(false)).removeEntry(fileName(entry.id));
			} catch {
				// Already gone.
			}
		} else if (entry.backend === 'idb') {
			await req((await this.#store(BLOBS, 'readwrite')).delete(entry.id));
		}
	}

	async #forgetBytes(entry: AudioEntry) {
		await this.#removeBytes(entry);
		if (entry.keep) {
			const rest: AudioEntry = { ...entry, size: 0 };
			delete rest.backend;
			await req((await this.#store(META, 'readwrite')).put(rest));
		} else {
			await req((await this.#store(META, 'readwrite')).delete(entry.id));
		}
	}

	/** Removes a source's bytes and its "keep offline" flag. */
	async delete(id: string): Promise<void> {
		const entry = await this.entry(id);
		if (!entry) return;
		await this.#removeBytes(entry);
		await req((await this.#store(META, 'readwrite')).delete(id));
	}

	/**
	 * Drops cached bytes that aren't kept offline, except `protect`ed ids (e.g. uploads that exist
	 * nowhere else). Returns how many bytes were freed.
	 */
	async clearUnkept(protect: (id: string) => boolean = () => false): Promise<number> {
		let freed = 0;
		for (const entry of await this.entries()) {
			if (entry.keep || !entry.backend || protect(entry.id)) continue;
			await this.#forgetBytes(entry);
			freed += entry.size;
		}
		return freed;
	}

	async usage(): Promise<Usage> {
		const usage: Usage = { count: 0, bytes: 0, keptCount: 0, keptBytes: 0 };
		for (const entry of await this.entries()) {
			if (!entry.backend) continue;
			usage.count++;
			usage.bytes += entry.size;
			if (entry.keep) {
				usage.keptCount++;
				usage.keptBytes += entry.size;
			}
		}
		return usage;
	}

	// Share-target inbox

	async addToInbox(item: InboxItem): Promise<void> {
		await req((await this.#store(INBOX, 'readwrite')).put(item));
	}

	async inbox(): Promise<InboxItem[]> {
		const items = (await req((await this.#store(INBOX, 'readonly')).getAll())) as InboxItem[];
		return items.sort((a, b) => b.receivedAt - a.receivedAt || (a.id < b.id ? -1 : 1));
	}

	async inboxItem(id: string): Promise<InboxItem | undefined> {
		return (await req((await this.#store(INBOX, 'readonly')).get(id))) as InboxItem | undefined;
	}

	/** Takes an item out of the inbox. With `discard`, its cached bytes go too. */
	async removeFromInbox(id: string, { discard = false } = {}): Promise<void> {
		await req((await this.#store(INBOX, 'readwrite')).delete(id));
		if (discard) await this.delete(id);
	}
}

export const audioCache = new AudioCache();
