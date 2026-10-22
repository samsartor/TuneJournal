import { PUBLIC_SYNC_URL } from '$app/env/public';
import {
	Repo,
	isValidAutomergeUrl,
	type DocHandle,
	type PeerId,
	type PeerMetadata
} from '@automerge/automerge-repo';
import { IndexedDBStorageAdapter } from '@automerge/automerge-repo-storage-indexeddb';
import { BrowserWebSocketClientAdapter } from '@automerge/automerge-repo-network-websocket';
import * as Automerge from '@automerge/automerge';
import { SCHEMA_VERSION, emptyLibrary, migrate } from '#lib/domain/library.ts';
import type { Library } from '#lib/domain/types.ts';
import { clearJournal, journalKey, readJournal, type KeyValueStore } from './journal.ts';

export const SYNC_URL = PUBLIC_SYNC_URL;
const LIBRARY_URL_KEY = 'tunejournal.libraryUrl';
const PREVIOUS_URLS_KEY = 'tunejournal.previousLibraryUrls';

export type SocketState = 'connecting' | 'open' | 'closed';

/**
 * The relay connection, reporting its socket's state so the UI can tell "connecting" from "can't
 * reach the server". The stock adapter only reports peers.
 */
export class RelayAdapter extends BrowserWebSocketClientAdapter {
	socketState: SocketState = 'connecting';
	#listeners = new Set<() => void>();

	onSocketState(listener: () => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	#set(state: SocketState) {
		this.socketState = state;
		for (const listener of this.#listeners) listener();
	}

	override connect(peerId: PeerId, peerMetadata?: PeerMetadata) {
		super.connect(peerId, peerMetadata);
		const socket = this.socket;
		if (!socket) return;
		this.#set('connecting');
		const current = () => this.socket === socket;
		socket.addEventListener('open', () => current() && this.#set('open'));
		socket.addEventListener('close', () => current() && this.#set('closed'));
	}

	override disconnect() {
		if (!this.socket) return;
		super.disconnect();
		this.#set('closed');
	}

	/** Reconnects now, rather than on the adapter's 5 s retry timer. A no-op if already connected. */
	reconnect() {
		if (!this.peerId) return; // The repo hasn't connected us yet.
		const state = this.socket?.readyState;
		if (state === WebSocket.OPEN || state === WebSocket.CONNECTING) return;
		this.connect(this.peerId, this.peerMetadata);
	}
}

let repo: Repo | undefined;
let relay: RelayAdapter | undefined;

export function getRelay(): RelayAdapter {
	getRepo();
	return relay!;
}

export function getRepo(): Repo {
	if (!repo) {
		relay = new RelayAdapter(SYNC_URL);
		repo = new Repo({
			storage: new IndexedDBStorageAdapter('tunejournal'),
			network: [relay]
		});
		// Saves are debounced, so write out anything pending when the page is hidden or closed.
		// (The unsaved-changes journal covers the case where the page dies before this finishes.)
		const flush = () => void repo?.flush().catch((e) => console.warn('Flush failed', e));
		addEventListener('pagehide', flush);
		document.addEventListener('visibilitychange', () => {
			if (document.visibilityState === 'hidden') flush();
		});
		// Drop the socket while the browser says we're offline, rather than keep retrying, and
		// reconnect as soon as it says we're back.
		addEventListener('offline', () => relay?.disconnect());
		addEventListener('online', () => relay?.reconnect());
	}
	return repo;
}

export function browserStorage(): KeyValueStore | undefined {
	try {
		return globalThis.localStorage;
	} catch {
		return undefined;
	}
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

/** Libraries this device showed before linking to another, newest first. */
export function previousLibraryUrls(): string[] {
	try {
		const list = JSON.parse(localStorage.getItem(PREVIOUS_URLS_KEY) ?? '[]');
		return Array.isArray(list) ? list.filter(isValidAutomergeUrl) : [];
	} catch {
		return [];
	}
}

/** Makes `url` the library this device opens, remembering the one it replaces. */
export function setActiveLibraryUrl(url: string, replaced?: string) {
	try {
		const previous = previousLibraryUrls().filter((u) => u !== url && u !== replaced);
		if (replaced && replaced !== url) previous.unshift(replaced);
		localStorage.setItem(PREVIOUS_URLS_KEY, JSON.stringify(previous.slice(0, 10)));
	} catch (e) {
		console.warn('Could not remember the previous library', e);
	}
	storeUrl(url);
}

/** Runs migrations and replays changes a previous session journaled but may not have saved. */
async function prepare(handle: DocHandle<Library>) {
	const key = journalKey(handle.documentId);
	const unsaved = readJournal(browserStorage(), key);
	if (unsaved) {
		handle.update((doc) => Automerge.loadIncremental(doc, unsaved));
		await getRepo().flush([handle.documentId]);
		clearJournal(browserStorage(), key);
	}
	if (handle.doc().schemaVersion < SCHEMA_VERSION) handle.change(migrate);
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

	await prepare(handle);
	return handle;
}

export type FindFailure = 'offline' | 'unreachable' | 'unavailable' | 'not-a-library';

export class FindLibraryError extends Error {
	constructor(readonly reason: FindFailure) {
		super(FIND_FAILURE_MESSAGE[reason]);
		this.name = 'FindLibraryError';
	}
}

const FIND_FAILURE_MESSAGE: Record<FindFailure, string> = {
	offline: 'This device is offline. Connect to the internet and try again.',
	unreachable: 'Couldn’t reach the sync server. Check your connection, or try again in a moment.',
	unavailable:
		'The sync server doesn’t have this library yet. Open TuneJournal on the other device so it can sync, then try again.',
	'not-a-library': 'That address isn’t a TuneJournal library.'
};

export interface FindOptions {
	signal?: AbortSignal;
	/** Give up after this long. */
	timeoutMs?: number;
	/** Once the relay has said it doesn't have the doc, wait this much longer for it to appear. */
	unavailableGraceMs?: number;
}

/** Whether the relay is connected, i.e. it has introduced itself as a peer. */
export const relayConnected = () => getRepo().peers.length > 0;

/**
 * Finds a library by URL, from local storage or the relay, for linking this device to it. Rejects
 * with a `FindLibraryError` saying why if it doesn't turn up, or an `AbortError` if cancelled.
 */
export async function findLibrary(
	url: string,
	{ signal, timeoutMs = 20_000, unavailableGraceMs = 5_000 }: FindOptions = {}
): Promise<DocHandle<Library>> {
	if (!isValidAutomergeUrl(url)) throw new FindLibraryError('not-a-library');
	const repo = getRepo();
	// Don't use `repo.find`: it gives up as soon as the relay says it doesn't have the doc, while
	// the other device may be about to upload it. The handle turns ready whenever the doc arrives.
	const { handle } = repo.findWithProgress<Library>(url);

	await new Promise<void>((resolve, reject) => {
		const started = Date.now();
		let unavailableSince: number | undefined;
		const finish = (error?: unknown) => {
			clearInterval(poll);
			signal?.removeEventListener('abort', abort);
			if (error) reject(error);
			else resolve();
		};
		const abort = () => finish(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
		const poll = setInterval(() => {
			if (handle.isReady()) return finish();
			const now = Date.now();
			if (handle.state === 'unavailable') unavailableSince ??= now;
			if (!navigator.onLine && (handle.state === 'unavailable' || now - started > 2_000)) {
				return finish(new FindLibraryError('offline'));
			}
			const connected = relayConnected();
			if (connected && unavailableSince && now - unavailableSince > unavailableGraceMs) {
				return finish(new FindLibraryError('unavailable'));
			}
			if (now - started > timeoutMs) {
				return finish(new FindLibraryError(connected ? 'unavailable' : 'unreachable'));
			}
		}, 200);
		if (signal?.aborted) return abort();
		signal?.addEventListener('abort', abort);
		handle
			.whenReady(['ready'])
			.then(() => finish())
			.catch(() => {});
	});

	const pieces: unknown = handle.doc()?.pieces;
	if (typeof pieces !== 'object' || pieces === null) {
		throw new FindLibraryError('not-a-library');
	}
	await prepare(handle);
	return handle;
}
