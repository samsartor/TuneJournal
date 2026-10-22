// Spike-only blob store shared by the pages and the service worker. Writes to OPFS, falling back
// to IndexedDB where OPFS writes aren't available (e.g. Safari service workers lack createWritable).
// Runs under both the DOM and WebWorker libs, so it only touches `navigator.storage` and `indexedDB`.

export type Backend = 'opfs' | 'idb';

export interface StoredFile {
	dir: string;
	name: string;
	type: string;
	size: number;
	lastModified: number;
	backend: Backend;
}

const IDB_NAME = 'tunejournal-spike-files';
const IDB_STORE = 'files';

interface IdbRow {
	key: string;
	dir: string;
	name: string;
	blob: Blob;
	type: string;
	lastModified: number;
}

function req<T>(r: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		r.onsuccess = () => resolve(r.result);
		r.onerror = () => reject(r.error);
	});
}

let db: Promise<IDBDatabase> | undefined;
function openDb(): Promise<IDBDatabase> {
	db ??= new Promise((resolve, reject) => {
		const open = indexedDB.open(IDB_NAME, 1);
		open.onupgradeneeded = () => open.result.createObjectStore(IDB_STORE, { keyPath: 'key' });
		open.onsuccess = () => resolve(open.result);
		open.onerror = () => reject(open.error);
	});
	return db;
}

async function idbStore(mode: IDBTransactionMode) {
	return (await openDb()).transaction(IDB_STORE, mode).objectStore(IDB_STORE);
}

async function opfsDir(dir: string, create: boolean) {
	const root = await navigator.storage.getDirectory();
	return root.getDirectoryHandle(dir, { create });
}

export function opfsAvailable(): boolean {
	return typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function';
}

export async function putFile(dir: string, name: string, blob: Blob): Promise<Backend> {
	if (opfsAvailable()) {
		try {
			const handle = await (await opfsDir(dir, true)).getFileHandle(name, { create: true });
			if (typeof handle.createWritable === 'function') {
				const writable = await handle.createWritable();
				await writable.write(blob);
				await writable.close();
				// OPFS doesn't keep the MIME type, so remember it alongside.
				if (blob.type) await putType(dir, name, blob.type);
				return 'opfs';
			}
		} catch (e) {
			console.warn('OPFS write failed, falling back to IndexedDB', e);
		}
	}
	const row: IdbRow = {
		key: `${dir}/${name}`,
		dir,
		name,
		blob,
		type: blob.type,
		lastModified: Date.now()
	};
	await req((await idbStore('readwrite')).put(row));
	return 'idb';
}

const TYPES = '.types.json';

async function readTypes(dir: string): Promise<Record<string, string>> {
	try {
		const file = await (await (await opfsDir(dir, false)).getFileHandle(TYPES)).getFile();
		return JSON.parse(await file.text());
	} catch {
		return {};
	}
}

async function putType(dir: string, name: string, type: string) {
	const types = await readTypes(dir);
	types[name] = type;
	const handle = await (await opfsDir(dir, true)).getFileHandle(TYPES, { create: true });
	const writable = await handle.createWritable();
	await writable.write(JSON.stringify(types));
	await writable.close();
}

export async function listFiles(dir: string): Promise<StoredFile[]> {
	const out: StoredFile[] = [];
	if (opfsAvailable()) {
		try {
			const handle = await opfsDir(dir, false);
			const types = await readTypes(dir);
			for await (const [name, entry] of handle.entries()) {
				if (name === TYPES || entry.kind !== 'file') continue;
				const file = await (entry as FileSystemFileHandle).getFile();
				out.push({
					dir,
					name,
					type: types[name] ?? file.type,
					size: file.size,
					lastModified: file.lastModified,
					backend: 'opfs'
				});
			}
		} catch {
			// No such directory yet.
		}
	}
	const rows = (await req((await idbStore('readonly')).getAll())) as IdbRow[];
	for (const row of rows) {
		if (row.dir !== dir) continue;
		out.push({
			dir,
			name: row.name,
			type: row.type,
			size: row.blob.size,
			lastModified: row.lastModified,
			backend: 'idb'
		});
	}
	return out.sort((a, b) => b.lastModified - a.lastModified);
}

export async function getFile(f: Pick<StoredFile, 'dir' | 'name' | 'type' | 'backend'>) {
	if (f.backend === 'opfs') {
		const file = await (await (await opfsDir(f.dir, false)).getFileHandle(f.name)).getFile();
		// Re-wrap so the blob carries the remembered MIME type.
		return new Blob([file], { type: f.type });
	}
	const row = (await req((await idbStore('readonly')).get(`${f.dir}/${f.name}`))) as
		IdbRow | undefined;
	if (!row) throw new Error(`No such file ${f.dir}/${f.name}`);
	return row.blob;
}

export async function deleteFile(f: Pick<StoredFile, 'dir' | 'name' | 'backend'>) {
	if (f.backend === 'opfs') {
		await (await opfsDir(f.dir, false)).removeEntry(f.name);
	} else {
		await req((await idbStore('readwrite')).delete(`${f.dir}/${f.name}`));
	}
}
