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
import {
	addChild,
	linkPieces,
	mergeWithUndo,
	removeLink,
	restoreLink,
	undoMerge,
	type MergeOptions
} from '#lib/domain/relations.ts';
import type { PieceId, PieceKind } from '#lib/domain/types.ts';
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
	/** The piece "Merge with…" is picking a partner for. */
	mergePicking = $state<PieceId>();
	toast = $state<Toast>();
	/**
	 * Set when "Open details" is followed from Shuffle, so that piece's detail view offers
	 * "← Shuffle" (a history back to the same card). Cleared by any other navigation.
	 */
	shuffleReturn = $state<{ id: PieceId; href: string }>();
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

	/** "Merge with…" (§6.4): pick the other piece, then confirm in the merge dialog. */
	openMergePicker(id: PieceId) {
		this.mergePicking = id;
	}

	closeMergePicker() {
		this.mergePicking = undefined;
	}

	/** Merges `losers` into `survivor` (§6.4), then shows the survivor. Undo puts both back. */
	async merge(survivor: PieceId, losers: PieceId[], fields?: MergeOptions['fields']) {
		const { id, undo } = library.change((d) => mergeWithUndo(d, survivor, losers, { fields }));
		this.closeMerge();
		this.now = Date.now();
		const n = losers.length + 1;
		this.showToast(`Merged ${n} pieces into ${this.#name(id)}`, {
			label: 'Undo',
			run: () => library.change((d) => undoMerge(d, undo))
		});
		await goto(resolve('/(main)/piece/[id]', { id }));
	}

	/** Adds an existing piece as the parent's last child. */
	addChild(parent: PieceId, child: PieceId) {
		library.change((d) => linkPieces(d, parent, child));
		this.showToast(`Added ${this.#name(child)}`);
	}

	/** Creates a new child (§6.4 "New …"), and opens Edit on it if it has no title yet. */
	newChild(parent: PieceId, kind: PieceKind, title?: string) {
		const id = library.change((d) => addChild(d, parent, { kind, title }));
		this.now = Date.now();
		if (title?.trim()) this.showToast(`Added ${this.#name(id)}`);
		else this.openEdit(id, true);
		return id;
	}

	/** Removes a link (never the piece), with undo. */
	unlink(parent: PieceId, child: PieceId) {
		const link = library.change((d) => removeLink(d, parent, child));
		if (!link) return;
		this.showToast(`Removed ${this.#name(child)} from ${this.#name(parent)}`, {
			label: 'Undo',
			run: () => library.change((d) => restoreLink(d, link))
		});
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
