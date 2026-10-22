import type { DocHandle, StorageId, UrlHeads } from '@automerge/automerge-repo';
import { getRelay, getRepo, SYNC_URL } from './repo.ts';

export type SyncState = 'offline' | 'connecting' | 'connected';

/** How long the relay may lag behind before we say "Syncing…" rather than "Synced". */
const BEHIND_AFTER_MS = 1500;

/**
 * Connection and sync status for the active library, derived from automerge-repo:
 * - the relay adapter's socket (open/closed) and `navigator.onLine`,
 * - the relay introducing itself as a peer (`networkSubsystem` "peer" / "peer-disconnected"),
 * - the relay's heads for our doc (`handle.on('remote-heads')`, keyed by the relay's storage id),
 *   compared with our own heads to tell whether it has everything we have.
 */
class SyncStatus {
	online = $state(true);
	relayConnected = $state(false);
	/** The last connection attempt failed, and none has succeeded since. */
	unreachable = $state(false);
	/** The relay has the same heads as this device. */
	synced = $state(false);
	/** When the relay last confirmed it had everything this device has. */
	lastSyncAt = $state<number>();
	/** Not synced for a while, though connected: changes are on their way. */
	behind = $state(false);

	readonly server = hostOf(SYNC_URL);

	state: SyncState = $derived(
		!this.online
			? 'offline'
			: this.relayConnected
				? 'connected'
				: this.unreachable
					? 'offline'
					: 'connecting'
	);

	label = $derived(
		this.state === 'offline'
			? 'Offline'
			: this.state === 'connecting'
				? 'Connecting…'
				: this.behind
					? 'Syncing…'
					: 'Synced'
	);

	#started = false;
	#relayStorageId?: StorageId;
	#handle?: DocHandle<unknown>;
	#behindTimer?: ReturnType<typeof setTimeout>;

	start() {
		if (this.#started) return;
		this.#started = true;
		const repo = getRepo();
		const relay = getRelay();

		this.online = navigator.onLine;
		addEventListener('online', () => {
			this.online = true;
			this.unreachable = false;
		});
		addEventListener('offline', () => (this.online = false));

		relay.onSocketState(() => {
			if (relay.socketState === 'closed') this.unreachable = true;
		});
		repo.networkSubsystem.on('peer', ({ peerMetadata }) => {
			this.#relayStorageId = peerMetadata?.storageId;
			this.relayConnected = true;
			this.unreachable = false;
			this.#check();
		});
		repo.networkSubsystem.on('peer-disconnected', () => {
			this.relayConnected = repo.peers.length > 0;
			this.#check();
		});
		this.relayConnected = repo.peers.length > 0;
	}

	/** Follows `handle` as the active library. Returns a function that stops following it. */
	watch(handle: DocHandle<unknown>): () => void {
		this.start();
		this.#handle = handle;
		this.synced = false;
		this.lastSyncAt = undefined;
		const check = () => this.#check();
		const confirmed = () => this.#check(true);
		handle.on('remote-heads', confirmed);
		handle.on('heads-changed', check);
		this.#check();
		return () => {
			handle.off('remote-heads', confirmed);
			handle.off('heads-changed', check);
			if (this.#handle === handle) this.#handle = undefined;
		};
	}

	/** `fresh`: the relay just reported its heads, so a match is a sync that happened now. */
	#check(fresh = false) {
		const handle = this.#handle;
		let synced = false;
		if (handle && this.relayConnected) {
			if (!this.#relayStorageId) {
				// A relay without storage doesn't report heads; being connected is all we can know.
				synced = true;
			} else {
				const remote = handle.getSyncInfo(this.#relayStorageId)?.lastHeads;
				synced = !!remote && sameHeads(remote, handle.heads());
			}
		}
		if (synced && (fresh || !this.synced || this.lastSyncAt === undefined)) {
			this.lastSyncAt = Date.now();
		}
		this.synced = synced;

		clearTimeout(this.#behindTimer);
		if (synced || !this.relayConnected) this.behind = false;
		else if (!this.behind) {
			this.#behindTimer = setTimeout(() => (this.behind = true), BEHIND_AFTER_MS);
		}
	}
}

function sameHeads(a: UrlHeads, b: UrlHeads) {
	return a.length === b.length && a.every((h) => b.includes(h));
}

function hostOf(url: string) {
	try {
		return new URL(url).host;
	} catch {
		return url;
	}
}

export const sync = new SyncStatus();
