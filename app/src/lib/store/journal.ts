import * as Automerge from '@automerge/automerge';

/** The bits of `Storage` we use, so tests can pass a Map-backed fake. */
export interface KeyValueStore {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

export const journalKey = (documentId: string) => `tunejournal.unsaved.${documentId}`;

/**
 * Saves each local change right away, with a write-ahead copy until the save is confirmed.
 *
 * automerge-repo throttles saves, so a change can wait up to ~100 ms before its IndexedDB write
 * even starts, and a reload in that window lost it in M1 (a `pagehide` flush didn't help).
 * `record()` fixes that by flushing the doc as soon as it changes: once the write is issued,
 * Chromium completes it even if the page is unloading.
 *
 * As a safety net for browsers or crashes that drop an in-flight write, `record()` also stores the
 * changes since the last confirmed save in `localStorage`, synchronously, and removes them when the
 * flush completes. On the next load, `readJournal` returns anything left over to merge back in;
 * loading changes the doc already has is a no-op, so replaying is always safe.
 */
export class UnsavedJournal<T> {
	readonly #key: string;
	readonly #doc: () => Automerge.Doc<T>;
	readonly #flush: () => Promise<void>;
	readonly #storage: KeyValueStore | undefined;
	/** Heads known to be in IndexedDB. */
	#durable: Automerge.Heads;
	#issued = 0;
	#settled = 0;

	constructor(options: {
		key: string;
		doc: () => Automerge.Doc<T>;
		flush: () => Promise<void>;
		storage: KeyValueStore | undefined;
	}) {
		this.#key = options.key;
		this.#doc = options.doc;
		this.#flush = options.flush;
		this.#storage = options.storage;
		this.#durable = Automerge.getHeads(this.#doc());
	}

	/** Call after each local change. Returns once the change is in IndexedDB. */
	async record(): Promise<void> {
		const doc = this.#doc();
		const heads = Automerge.getHeads(doc);
		if (sameHeads(heads, this.#durable)) return;
		this.#write(doc);

		const seq = ++this.#issued;
		try {
			await this.#flush();
		} catch (e) {
			// The journal still holds the changes, so they'll be replayed on the next load.
			console.warn('Could not save the library', e);
			return;
		}
		// Flushes can settle out of order; only ever move the durable heads forward.
		if (seq <= this.#settled) return;
		this.#settled = seq;
		this.#durable = heads;
		const now = this.#doc();
		if (sameHeads(Automerge.getHeads(now), heads)) this.#clear();
		else this.#write(now);
	}

	#write(doc: Automerge.Doc<T>) {
		try {
			this.#storage?.setItem(this.#key, toBase64(Automerge.saveSince(doc, this.#durable)));
		} catch (e) {
			// Quota or privacy mode. The IndexedDB save is still on its way, so carry on.
			console.warn('Could not journal unsaved changes', e);
		}
	}

	#clear() {
		try {
			this.#storage?.removeItem(this.#key);
		} catch {
			// Nothing useful to do.
		}
	}
}

/** Changes a previous session journaled but may not have saved, if any. */
export function readJournal(
	storage: KeyValueStore | undefined,
	key: string
): Uint8Array | undefined {
	try {
		const text = storage?.getItem(key);
		return text ? fromBase64(text) : undefined;
	} catch (e) {
		console.warn('Ignoring an unreadable unsaved-changes journal', e);
		return undefined;
	}
}

export function clearJournal(storage: KeyValueStore | undefined, key: string) {
	try {
		storage?.removeItem(key);
	} catch {
		// Nothing useful to do.
	}
}

function sameHeads(a: Automerge.Heads, b: Automerge.Heads) {
	return a.length === b.length && a.every((h) => b.includes(h));
}

export function toBase64(bytes: Uint8Array): string {
	let binary = '';
	const CHUNK = 0x8000;
	for (let i = 0; i < bytes.length; i += CHUNK) {
		binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
	}
	return btoa(binary);
}

export function fromBase64(text: string): Uint8Array {
	const binary = atob(text);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}
