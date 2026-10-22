// A minimal automerge-repo sync relay for the e2e tests, so they don't depend on the public one.
// It's the same setup as @automerge/automerge-repo-sync-server, minus Express and the filesystem:
// a server-mode Repo (it only shares docs that peers ask for) with in-memory storage, so it reports
// a storage id and remote heads like a real relay.
//
//   node e2e/sync-server.ts            # listens on SYNC_PORT, default 3031
import { Repo, type StorageAdapterInterface, type StorageKey } from '@automerge/automerge-repo';
import { NodeWSServerAdapter } from '@automerge/automerge-repo-network-websocket';
import { WebSocketServer } from 'ws';

class MemoryStorage implements StorageAdapterInterface {
	#data = new Map<string, Uint8Array>();
	#key = (key: StorageKey) => key.join('\u0000');
	#has = (key: string, prefix: StorageKey) =>
		prefix.length === 0 ||
		key === this.#key(prefix) ||
		key.startsWith(this.#key(prefix) + '\u0000');

	async load(key: StorageKey) {
		return this.#data.get(this.#key(key));
	}
	async save(key: StorageKey, data: Uint8Array) {
		this.#data.set(this.#key(key), data);
	}
	async remove(key: StorageKey) {
		this.#data.delete(this.#key(key));
	}
	async loadRange(prefix: StorageKey) {
		return [...this.#data]
			.filter(([key]) => this.#has(key, prefix))
			.map(([key, data]) => ({ key: key.split('\u0000'), data }));
	}
	async removeRange(prefix: StorageKey) {
		for (const key of [...this.#data.keys()]) if (this.#has(key, prefix)) this.#data.delete(key);
	}
}

type ServerSocket = ConstructorParameters<typeof NodeWSServerAdapter>[0];

const port = Number(process.env.SYNC_PORT ?? 3031);
const socket = new WebSocketServer({ port });
const repo = new Repo({
	// isomorphic-ws's WebSocketServer type is the same class as ws's, typed via another path.
	network: [new NodeWSServerAdapter(socket as unknown as ServerSocket)],
	storage: new MemoryStorage(),
	sharePolicy: async () => false
});

socket.on('listening', () => console.log(`Sync relay listening on ws://localhost:${port}`));

const stop = async () => {
	await repo.shutdown().catch(() => {});
	socket.close();
	process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
