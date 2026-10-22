import * as Automerge from '@automerge/automerge';
import type { DocHandle } from '@automerge/automerge-repo';
import { getIndex, type LibraryIndex } from '#lib/domain/derived.ts';
import { copyMissing, type CopyResult } from '#lib/domain/transfer.ts';
import type { Library } from '#lib/domain/types.ts';
import { sharesHistory } from './history';
import { UnsavedJournal, journalKey } from './journal.ts';
import { browserStorage, getRepo, openLibrary, setActiveLibraryUrl } from './repo';
import { sync } from './sync.svelte.ts';

type Status = 'idle' | 'loading' | 'ready' | 'error';

export type ImportResult = { mode: 'merged' } | ({ mode: 'copied' } & CopyResult);

export interface SwitchOptions {
	/** Bring this device's current pieces along into the new library. */
	mergeLocal?: boolean;
}

class LibraryStore {
	// Automerge docs are immutable snapshots, so swap them wholesale rather than deep-proxying.
	doc = $state.raw<Library>();
	url = $state<string>();
	status = $state<Status>('idle');
	error = $state.raw<unknown>();
	index: LibraryIndex | undefined = $derived(this.doc ? getIndex(this.doc) : undefined);

	#handle?: DocHandle<Library>;
	#journal?: UnsavedJournal<Library>;
	#detach?: () => void;
	#persistRequested = false;

	async load() {
		if (this.status !== 'idle') return;
		this.status = 'loading';
		try {
			this.#attach(await openLibrary());
			this.status = 'ready';
		} catch (e) {
			console.error('Failed to open library', e);
			this.error = e;
			this.status = 'error';
		}
	}

	#attach(handle: DocHandle<Library>) {
		this.#detach?.();
		this.#handle = handle;
		this.#journal = new UnsavedJournal({
			key: journalKey(handle.documentId),
			doc: () => handle.doc(),
			flush: () => getRepo().flush([handle.documentId]),
			storage: browserStorage()
		});
		this.url = handle.url;
		this.doc = handle.doc();
		const onChange = ({ doc }: { doc: Library }) => (this.doc = doc);
		handle.on('change', onChange);
		const unwatch = sync.watch(handle as DocHandle<unknown>);
		this.#detach = () => {
			handle.off('change', onChange);
			unwatch();
		};
	}

	change<T>(fn: (lib: Library) => T): T {
		if (!this.#handle) throw new Error('Library is not loaded');
		let result!: T;
		this.#handle.change((d) => {
			result = fn(d);
		});
		this.#saved();
		return result;
	}

	/** After every local write: journal it until it's on disk, and ask for persistent storage. */
	#saved(): Promise<void> {
		this.#requestPersistence();
		return this.#journal?.record() ?? Promise.resolve();
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
		const result = mergeInto(handle, incoming);
		this.#saved();
		return result;
	}

	/**
	 * Makes `handle` the library this device shows (§4 device pairing). The current library stays in
	 * IndexedDB, and its URL is remembered, but it's no longer opened. With `mergeLocal`, its pieces
	 * come along first, merged the same way as an imported backup.
	 */
	async switchTo(handle: DocHandle<Library>, { mergeLocal = false }: SwitchOptions = {}) {
		const old = this.#handle;
		if (old?.documentId === handle.documentId) return;
		const result = mergeLocal && old ? mergeInto(handle, old.doc()) : undefined;
		// Make sure the old library is on disk before we stop opening it, and the new one before we
		// point at it.
		const repo = getRepo();
		await repo.flush([handle.documentId, ...(old ? [old.documentId] : [])]);
		const hadPieces = !!old && Object.keys(old.doc().pieces).length > 0;
		setActiveLibraryUrl(handle.url, hadPieces ? old.url : undefined);
		this.#attach(handle);
		this.error = undefined;
		this.status = 'ready';
		return result;
	}
}

/**
 * Merges `incoming` into the library behind `handle`. A copy of the same library (it shares a root
 * change) merges as a CRDT. An unrelated library would conflict at the root maps, so its pieces,
 * sources and links are copied in by id instead.
 */
function mergeInto(handle: DocHandle<Library>, incoming: Automerge.Doc<Library>): ImportResult {
	if (sharesHistory(handle.doc(), incoming)) {
		handle.update((doc) => Automerge.merge(doc, incoming));
		return { mode: 'merged' };
	}
	const plain = Automerge.toJS(incoming);
	let result!: CopyResult;
	handle.change((d) => {
		result = copyMissing(d, plain);
	});
	return { mode: 'copied', ...result };
}

export const library = new LibraryStore();
