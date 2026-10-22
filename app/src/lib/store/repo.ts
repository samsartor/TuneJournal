import { Repo, isValidAutomergeUrl, type DocHandle } from '@automerge/automerge-repo';
import { IndexedDBStorageAdapter } from '@automerge/automerge-repo-storage-indexeddb';
import { BrowserWebSocketClientAdapter } from '@automerge/automerge-repo-network-websocket';
import { SCHEMA_VERSION, emptyLibrary, migrate } from '#lib/domain/library.ts';
import type { Library } from '#lib/domain/types.ts';

const SYNC_URL = 'wss://sync.automerge.org';
const LIBRARY_URL_KEY = 'tunejournal.libraryUrl';

let repo: Repo | undefined;

export function getRepo(): Repo {
	if (!repo) {
		repo = new Repo({
			storage: new IndexedDBStorageAdapter('tunejournal'),
			network: [new BrowserWebSocketClientAdapter(SYNC_URL)]
		});
		// Saves are debounced, so write out anything pending when the page is hidden or closed.
		const flush = () => void repo?.flush().catch((e) => console.warn('Flush failed', e));
		addEventListener('pagehide', flush);
		document.addEventListener('visibilitychange', () => {
			if (document.visibilityState === 'hidden') flush();
		});
	}
	return repo;
}

function readStoredUrl(): string | null {
	try {
		return localStorage.getItem(LIBRARY_URL_KEY);
	} catch {
		return null;
	}
}

function storeUrl(url: string) {
	try {
		localStorage.setItem(LIBRARY_URL_KEY, url);
	} catch (e) {
		console.warn('Could not persist library URL', e);
	}
}

/** Opens this device's Library doc, creating it on first run, and runs migrations. */
export async function openLibrary(): Promise<DocHandle<Library>> {
	const repo = getRepo();
	const stored = readStoredUrl();

	let handle: DocHandle<Library>;
	if (isValidAutomergeUrl(stored)) {
		// Throws if the doc is in neither local storage nor the relay. We don't silently replace it
		// with a fresh library, since that would orphan the user's data.
		handle = await repo.find<Library>(stored);
	} else {
		handle = repo.create<Library>(emptyLibrary());
		// Persist before remembering the URL, so a crash can't leave it pointing at nothing.
		await repo.flush([handle.documentId]);
		storeUrl(handle.url);
	}

	if (handle.doc().schemaVersion < SCHEMA_VERSION) handle.change(migrate);
	return handle;
}
