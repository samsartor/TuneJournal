import * as Automerge from '@automerge/automerge';
import { describe, expect, it } from 'vitest';
import {
	UnsavedJournal,
	clearJournal,
	fromBase64,
	readJournal,
	toBase64,
	type KeyValueStore
} from './journal.ts';

type Doc = { items: string[] };
const KEY = 'tunejournal.unsaved.test';

function memoryStore(): KeyValueStore & { map: Map<string, string> } {
	const map = new Map<string, string>();
	return {
		map,
		getItem: (k) => map.get(k) ?? null,
		setItem: (k, v) => void map.set(k, v),
		removeItem: (k) => void map.delete(k)
	};
}

function deferred() {
	let resolve!: () => void;
	let reject!: (e: unknown) => void;
	const promise = new Promise<void>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

function setup() {
	const storage = memoryStore();
	let doc = Automerge.from<Doc>({ items: [] });
	const saved = Automerge.clone(doc);
	const flushes: ReturnType<typeof deferred>[] = [];
	const journal = new UnsavedJournal<Doc>({
		key: KEY,
		doc: () => doc,
		flush: () => {
			const d = deferred();
			flushes.push(d);
			return d.promise;
		},
		storage
	});
	const change = (item: string) => {
		doc = Automerge.change(doc, (d) => void d.items.push(item));
		return journal.record();
	};
	return { storage, saved, flushes, change, doc: () => doc };
}

describe('UnsavedJournal', () => {
	it('journals a change synchronously, so a reload before the save can replay it', () => {
		const { storage, saved, change } = setup();
		void change('The Kesh');
		const pending = readJournal(storage, KEY);
		expect(pending).toBeDefined();
		const recovered = Automerge.loadIncremental(Automerge.clone(saved), pending!);
		expect(recovered.items).toEqual(['The Kesh']);
	});

	it('clears the journal once the save completes', async () => {
		const { storage, flushes, change } = setup();
		const done = change('The Kesh');
		flushes[0].resolve();
		await done;
		expect(storage.map.has(KEY)).toBe(false);
	});

	it('keeps newer changes when an earlier save completes', async () => {
		const { storage, flushes, change, doc } = setup();
		const first = change('The Kesh');
		const savedByFirst = Automerge.clone(doc());
		const second = change('Drowsy Maggie');
		flushes[0].resolve();
		await first;
		// Only what the first save didn't cover is kept, and it replays onto that save.
		const pending = readJournal(storage, KEY)!;
		const recovered = Automerge.loadIncremental(savedByFirst, pending);
		expect(recovered.items).toEqual(['The Kesh', 'Drowsy Maggie']);

		flushes[1].resolve();
		await second;
		expect(storage.map.has(KEY)).toBe(false);
	});

	it('ignores a save that settles after a newer one', async () => {
		const { storage, flushes, change } = setup();
		const first = change('The Kesh');
		const second = change('Drowsy Maggie');
		flushes[1].resolve();
		await second;
		expect(storage.map.has(KEY)).toBe(false);
		flushes[0].resolve();
		await first;
		expect(storage.map.has(KEY)).toBe(false);
	});

	it('keeps the journal when the save fails', async () => {
		const { storage, flushes, change } = setup();
		const done = change('The Kesh');
		flushes[0].reject(new Error('disk full'));
		await done;
		expect(storage.map.has(KEY)).toBe(true);
	});

	it('replaying a journal the doc already has changes nothing', () => {
		const { storage, change, doc } = setup();
		void change('The Kesh');
		const replayed = Automerge.loadIncremental(Automerge.clone(doc()), readJournal(storage, KEY)!);
		expect(replayed.items).toEqual(['The Kesh']);
		expect(Automerge.getHeads(replayed)).toEqual(Automerge.getHeads(doc()));
	});

	it('treats an unreadable journal as empty', () => {
		const storage = memoryStore();
		storage.setItem(KEY, '!!not base64!!');
		expect(readJournal(storage, KEY)).toBeUndefined();
		clearJournal(storage, KEY);
		expect(storage.map.has(KEY)).toBe(false);
	});
});

describe('base64', () => {
	it('round-trips binary, including large arrays', () => {
		const bytes = new Uint8Array(100_000).map((_, i) => (i * 31) % 256);
		expect(fromBase64(toBase64(bytes))).toEqual(bytes);
		expect(toBase64(new Uint8Array([]))).toBe('');
	});
});
