// App-wide UI state that isn't synced: the open edit modal, toasts, and a ticking clock.

import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { untitled } from '#lib/domain/format.ts';
import {
	createPiece,
	logPractice,
	softDelete,
	undoDelete,
	unlogPractice
} from '#lib/domain/ops.ts';
import { mergePieces, type MergeOptions } from '#lib/domain/relations.ts';
import type { PieceId } from '#lib/domain/types.ts';
import { library } from '#lib/store/library.svelte.ts';

export interface Toast {
	id: number;
	message: string;
	action?: { label: string; run: () => void };
}

const TOAST_MS = 6000;

class Ui {
	editing = $state<{ id: PieceId; isNew: boolean }>();
	/** Pieces in the open merge dialog, oldest first. */
	merging = $state<PieceId[]>();
	toast = $state<Toast>();
	/** Epoch ms, refreshed every 30 s so relative times and date filters stay current. */
	now = $state(Date.now());

	#toastTimer?: ReturnType<typeof setTimeout>;
	#nextToast = 1;
	#clockStarted = false;

	startClock() {
		if (this.#clockStarted) return;
		this.#clockStarted = true;
		setInterval(() => (this.now = Date.now()), 30_000);
	}

	showToast(message: string, action?: Toast['action']) {
		clearTimeout(this.#toastTimer);
		this.toast = { id: this.#nextToast++, message, action };
		this.#toastTimer = setTimeout(() => this.dismissToast(), TOAST_MS);
	}

	dismissToast() {
		clearTimeout(this.#toastTimer);
		this.toast = undefined;
	}

	openEdit(id: PieceId, isNew = false) {
		this.editing = { id, isNew };
	}

	closeEdit() {
		this.editing = undefined;
	}

	openMerge(ids: PieceId[]) {
		this.merging = ids;
	}

	closeMerge() {
		this.merging = undefined;
	}

	/** Merges `losers` into `survivor` (§6.4), then shows the survivor. */
	async merge(survivor: PieceId, losers: PieceId[], fields?: MergeOptions['fields']) {
		const id = library.change((d) => mergePieces(d, survivor, losers, { fields }));
		this.closeMerge();
		this.now = Date.now();
		const n = losers.length + 1;
		this.showToast(`Merged ${n} pieces into ${this.#name(id)}`);
		await goto(resolve('/(main)/piece/[id]', { id }));
	}

	/** §6.3: create a blank Tune right away, show it, and open Edit on it. */
	async addPiece() {
		const id = library.change((d) => createPiece(d));
		this.now = Date.now();
		await goto(resolve('/(main)/piece/[id]', { id }));
		this.openEdit(id, true);
	}

	practice(id: PieceId) {
		const entry = library.change((d) => logPractice(d, id, { via: 'card' }));
		this.now = Date.now();
		this.showToast(`Practiced ${this.#name(id)}`, {
			label: 'Undo',
			run: () => library.change((d) => unlogPractice(d, id, entry.at))
		});
	}

	delete(id: PieceId) {
		const name = this.#name(id);
		library.change((d) => softDelete(d, id));
		this.showToast(`Deleted ${name}`, {
			label: 'Undo',
			run: () => library.change((d) => undoDelete(d, id))
		});
	}

	#name(id: PieceId) {
		const piece = library.doc?.pieces[id];
		if (!piece) return 'piece';
		return piece.title ? `“${piece.title}”` : untitled(piece.kind).toLowerCase();
	}
}

export const ui = new Ui();
