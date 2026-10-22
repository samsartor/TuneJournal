import * as Automerge from '@automerge/automerge';
import type { DocHandle } from '@automerge/automerge-repo';
import { getIndex, type LibraryIndex } from '#lib/domain/derived.ts';
import { copyMissing, type CopyResult } from '#lib/domain/transfer.ts';
import type { Library } from '#lib/domain/types.ts';
import { sharesHistory } from './history';
import { openLibrary } from './repo';

type Status = 'idle' | 'loading' | 'ready' | 'error';

export type ImportResult = { mode: 'merged' } | ({ mode: 'copied' } & CopyResult);

class LibraryStore {
	// Automerge docs are immutable snapshots, so swap them wholesale rather than deep-proxying.
	doc = $state.raw<Library>();
	url = $state<string>();
	status = $state<Status>('idle');
	error = $state.raw<unknown>();
	index: LibraryIndex | undefined = $derived(this.doc ? getIndex(this.doc) : undefined);

	#handle?: DocHandle<Library>;
	#persistRequested = false;

	async load() {
		if (this.status !== 'idle') return;
		this.status = 'loading';
		try {
			const handle = await openLibrary();
			this.#handle = handle;
			this.url = handle.url;
			this.doc = handle.doc();
			handle.on('change', ({ doc }) => (this.doc = doc));
			this.status = 'ready';
		} catch (e) {
			console.error('Failed to open library', e);
			this.error = e;
			this.status = 'error';
		}
	}

	change<T>(fn: (lib: Library) => T): T {
		if (!this.#handle) throw new Error('Library is not loaded');
		let result!: T;
		this.#handle.change((d) => {
			result = fn(d);
		});
		this.#requestPersistence();
		return result;
	}

	/** Asks the browser not to evict our storage, once per session, on the first write (§9). */
	#requestPersistence() {
		if (this.#persistRequested) return;
		this.#persistRequested = true;
		const storage = globalThis.navigator?.storage;
		if (!storage?.persist) return;
		storage
			.persisted()
			.then((persisted) => persisted || storage.persist())
			.catch((e) => console.warn('Could not request persistent storage', e));
	}

	exportBinary(): Uint8Array {
		if (!this.#handle) throw new Error('Library is not loaded');
		return Automerge.save(this.#handle.doc());
	}

	exportJson(): string {
		if (!this.#handle) throw new Error('Library is not loaded');
		return JSON.stringify(Automerge.toJS(this.#handle.doc()), null, '\t');
	}

	/**
	 * Merges a saved `.automerge` file into this library. A backup of this same library merges as a
	 * CRDT. An unrelated library would conflict at the root maps, so its pieces are copied instead.
	 */
	importBinary(bytes: Uint8Array): ImportResult {
		const handle = this.#handle;
		if (!handle) throw new Error('Library is not loaded');
		const incoming = Automerge.load<Library>(bytes);
		if (!incoming.pieces || typeof incoming.pieces !== 'object') {
			throw new Error('That file isn’t a TuneJournal library');
		}
		if (sharesHistory(handle.doc(), incoming)) {
			handle.update((doc) => Automerge.loadIncremental(doc, bytes));
			this.#requestPersistence();
			return { mode: 'merged' };
		}
		const plain = Automerge.toJS(incoming);
		return { mode: 'copied', ...this.change((d) => copyMissing(d, plain)) };
	}
}

export const library = new LibraryStore();
