<!-- "Merge with…" (PLAN.md §6.4): pick the other piece, then confirm in MergeDialog. -->
<script lang="ts">
	import { untitled } from '#lib/domain/format.ts';
	import type { Piece, PieceId } from '#lib/domain/types.ts';
	import { library } from '#lib/store/library.svelte.ts';
	import PiecePicker from './PiecePicker.svelte';
	import { ui } from './state.svelte.ts';

	let dialog: HTMLDialogElement;

	const piece = $derived(ui.mergePicking ? library.doc?.pieces[ui.mergePicking] : undefined);
	const name = $derived(piece ? (piece.title ?? untitled(piece.kind)) : '');

	$effect(() => {
		if (ui.mergePicking && !dialog.open) dialog.showModal();
		else if (!ui.mergePicking && dialog.open) dialog.close();
	});

	function pick(other: Piece) {
		const id = ui.mergePicking;
		if (!id) return;
		ui.closeMergePicker();
		// This piece is offered as the one to keep; the dialog can switch it.
		ui.openMerge([id, other.id]);
	}
</script>

<dialog
	bind:this={dialog}
	onclose={() => ui.closeMergePicker()}
	aria-labelledby="merge-pick-heading"
>
	{#if piece}
		<div class="sheet">
			<h2 id="merge-pick-heading">Merge “{name}” with…</h2>
			<PiecePicker
				label="Find the other piece"
				actionLabel="Merge with"
				exclude={new Set<PieceId>([piece.id])}
				autofocus
				onpick={pick}
			/>
			<button type="button" class="btn-quiet cancel" onclick={() => dialog.close()}>Cancel</button>
		</div>
	{/if}
</dialog>

<style>
	dialog {
		width: min(32rem, calc(100% - 2 * var(--space-3)));
		max-height: calc(100dvh - 2 * var(--space-3));
		padding: 0;
		border: none;
		border-radius: var(--radius);
		background: var(--color-bg);
		color: var(--color-text);
		box-shadow: var(--shadow);
	}

	dialog::backdrop {
		background: rgb(0 0 0 / 0.4);
	}

	.sheet {
		display: grid;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-3) var(--space-4);
	}

	h2 {
		margin: 0;
		font-size: 1.125rem;
		overflow-wrap: anywhere;
	}

	.cancel {
		justify-self: start;
	}
</style>
