<!--
	The detail view's Related section (PLAN.md §6.4): "Part of" (parents) and "Contains" (children,
	in order). Children can be added (an existing piece or a new one), dragged or moved up/down,
	and removed with undo; removing a link never deletes the piece. "Split …" opens SplitDialog.
-->
<script lang="ts">
	import { resolve } from '$app/paths';
	import { KIND_LABEL, untitled } from '#lib/domain/format.ts';
	import { CHILD_KIND, linkProblem, moveChildAfter } from '#lib/domain/relations.ts';
	import type { Piece, PieceId } from '#lib/domain/types.ts';
	import { library } from '#lib/store/library.svelte.ts';
	import KindBadge from './KindBadge.svelte';
	import PiecePicker from './PiecePicker.svelte';
	import SplitDialog from './SplitDialog.svelte';
	import { ui } from './state.svelte.ts';

	let { piece }: { piece: Piece } = $props();

	const index = $derived(library.index);
	const parents = $derived(index ? index.parents(piece) : []);
	const children = $derived(index ? index.children(piece) : []);
	const childKind = $derived(CHILD_KIND[piece.kind]);
	const childLabel = $derived(KIND_LABEL[childKind]);
	// A Part has no conventional child, so it gets a generic "Add…".
	const addLabel = $derived(piece.kind === 'part' ? 'Add…' : `Add ${childLabel}`);
	const exclude = $derived(new Set<PieceId>([piece.id, ...children.map((c) => c.piece.id)]));
	const name = (p: Piece) => p.title ?? untitled(p.kind);

	let adding = $state(false);
	let splitting = $state(false);
	/** A picked piece that would make a loop, waiting for "Add anyway". */
	let cycle = $state<Piece>();

	function pick(other: Piece) {
		const doc = library.doc;
		if (!doc) return;
		const problem = linkProblem(doc, piece.id, other.id);
		if (problem === 'self') ui.showToast('A piece can’t contain itself');
		else if (problem === 'exists') ui.showToast(`${name(other)} is already here`);
		else if (problem === 'cycle') cycle = other;
		else {
			ui.addChild(piece.id, other.id);
			adding = false;
		}
	}

	function confirmCycle() {
		if (cycle) ui.addChild(piece.id, cycle.id);
		cycle = undefined;
		adding = false;
	}

	function create(title: string) {
		ui.newChild(piece.id, childKind, title || undefined);
		adding = false;
	}

	/** Moves a child so it follows `after` among the visible children (null = first). */
	function place(child: PieceId, parentOfLink: PieceId, after: PieceId | null) {
		library.change((d) => moveChildAfter(d, parentOfLink, child, after));
	}

	function moveBy(i: number, delta: -1 | 1) {
		const { link } = children[i];
		const others = children.filter((_, j) => j !== i);
		const to = i + delta;
		place(link.child, link.parent, to > 0 ? others[to - 1].link.child : null);
	}

	// Drag to reorder, as in Recordings (pointer events on a handle; buttons for keyboards).
	let list = $state<HTMLElement>();
	let drag = $state<{ id: PieceId; from: number; over: number; dy: number; height: number }>();
	let startY = 0;
	let centers: number[] = [];

	function dragStart(e: PointerEvent, id: PieceId, i: number) {
		if (e.button !== 0) return;
		const rows = [...(list?.children ?? [])] as HTMLElement[];
		centers = rows.map((r) => {
			const rect = r.getBoundingClientRect();
			return rect.top + rect.height / 2;
		});
		startY = e.clientY;
		drag = { id, from: i, over: i, dy: 0, height: rows[i]?.offsetHeight ?? 0 };
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		e.preventDefault();
	}

	function dragMove(e: PointerEvent) {
		if (!drag) return;
		const dy = e.clientY - startY;
		const center = centers[drag.from] + dy;
		let over = 0;
		centers.forEach((c, i) => {
			if (i !== drag!.from && c < center) over++;
		});
		drag = { ...drag, dy, over };
	}

	function dragEnd() {
		if (!drag) return;
		const { from, over } = drag;
		drag = undefined;
		if (over === from) return;
		const { link } = children[from];
		const others = children.filter((_, j) => j !== from);
		place(link.child, link.parent, over > 0 ? others[over - 1].link.child : null);
	}

	function shift(i: number): number {
		if (!drag || i === drag.from) return 0;
		if (drag.from < drag.over && i > drag.from && i <= drag.over) return -drag.height;
		if (drag.from > drag.over && i < drag.from && i >= drag.over) return drag.height;
		return 0;
	}
</script>

<section class="related" aria-labelledby="related-heading">
	<h2 id="related-heading">Related</h2>

	{#if parents.length > 0}
		<h3 id="parents-heading">Part of</h3>
		<ul class="rows" aria-labelledby="parents-heading">
			{#each parents as { piece: other, link } (other.id)}
				<li class="row">
					<KindBadge kind={other.kind} />
					<a class="name" href={resolve('/(main)/piece/[id]', { id: other.id })}>{name(other)}</a>
					<button
						type="button"
						class="icon-btn"
						aria-label="Remove from {name(other)}"
						title="Remove from {name(other)}"
						onclick={() => ui.unlink(link.parent, link.child)}>×</button
					>
				</li>
			{/each}
		</ul>
	{/if}

	{#if children.length > 0}
		<h3 id="children-heading">Contains <span class="muted count">{children.length}</span></h3>
		<ol class="rows" aria-labelledby="children-heading" bind:this={list}>
			{#each children as { piece: other, link }, i (other.id)}
				<li
					class="row child"
					class:dragging={drag?.id === other.id}
					style:transform={drag?.id === other.id
						? `translateY(${drag.dy}px)`
						: shift(i)
							? `translateY(${shift(i)}px)`
							: undefined}
					aria-label={name(other)}
					data-testid="child"
				>
					{#if children.length > 1}
						<span
							class="handle"
							aria-hidden="true"
							title="Drag to reorder"
							onpointerdown={(e) => dragStart(e, other.id, i)}
							onpointermove={dragMove}
							onpointerup={dragEnd}
							onpointercancel={dragEnd}>⠿</span
						>
					{/if}
					<KindBadge kind={other.kind} />
					<a class="name" href={resolve('/(main)/piece/[id]', { id: other.id })}>{name(other)}</a>
					{#if children.length > 1}
						<button
							type="button"
							class="icon-btn"
							aria-label="Move {name(other)} up"
							disabled={i === 0}
							onclick={() => moveBy(i, -1)}>↑</button
						>
						<button
							type="button"
							class="icon-btn"
							aria-label="Move {name(other)} down"
							disabled={i === children.length - 1}
							onclick={() => moveBy(i, 1)}>↓</button
						>
					{/if}
					<button
						type="button"
						class="icon-btn"
						aria-label="Remove {name(other)} from {name(piece)}"
						title="Remove from this {KIND_LABEL[piece.kind].toLowerCase()}"
						onclick={() => ui.unlink(link.parent, link.child)}>×</button
					>
				</li>
			{/each}
		</ol>
	{/if}

	{#if parents.length === 0 && children.length === 0 && !adding}
		<p class="muted">Not part of anything, and contains nothing.</p>
	{/if}

	{#if adding}
		<div class="add" role="group" aria-label={addLabel}>
			<PiecePicker
				label={piece.kind === 'part' ? 'Add a piece' : `Add a ${childLabel.toLowerCase()}`}
				actionLabel="Add"
				{exclude}
				oncreate={create}
				createLabel="New {childLabel}"
				autofocus
				onpick={pick}
			/>
			{#if cycle}
				<div class="warn" role="alert">
					<p>
						“{name(piece)}” is already inside “{name(cycle)}”. Adding it here makes a loop. That’s
						allowed, but practice will flow both ways.
					</p>
					<div class="buttons">
						<button type="button" onclick={confirmCycle}>Add anyway</button>
						<button type="button" class="btn-quiet" onclick={() => (cycle = undefined)}
							>Don’t add</button
						>
					</div>
				</div>
			{/if}
			<button
				type="button"
				class="btn-quiet cancel"
				onclick={() => {
					adding = false;
					cycle = undefined;
				}}>Cancel</button
			>
		</div>
	{:else}
		<div class="buttons">
			<button type="button" class="btn-quiet" onclick={() => (adding = true)}>+ {addLabel}</button>
			<button type="button" class="btn-quiet" onclick={() => (splitting = true)}
				>Split {childLabel}</button
			>
		</div>
	{/if}
</section>

{#if splitting}
	<SplitDialog {piece} onclose={() => (splitting = false)} />
{/if}

<style>
	.related {
		display: grid;
		gap: var(--space-2);
	}

	h2 {
		margin: 0;
		font-size: 0.8125rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--color-muted);
	}

	h3 {
		margin: var(--space-1) 0 0;
		font-size: 1rem;
	}

	.count {
		font-weight: 400;
		font-size: 0.875rem;
	}

	p {
		margin: 0;
	}

	.rows {
		display: grid;
		gap: var(--space-1);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.child {
		padding-left: var(--space-1);
		background: var(--color-bg);
		border-radius: var(--radius);
		transition: transform 120ms ease;
	}

	.child.dragging {
		z-index: 2;
		transition: none;
		background: var(--color-surface);
		box-shadow: var(--shadow);
	}

	.name {
		flex: 1;
		min-width: 0;
		display: inline-flex;
		align-items: center;
		min-height: var(--touch);
		overflow-wrap: anywhere;
	}

	.handle {
		display: grid;
		place-items: center;
		width: 1.5rem;
		min-height: var(--touch);
		color: var(--color-muted);
		cursor: grab;
		touch-action: none;
		user-select: none;
	}

	.icon-btn:disabled {
		opacity: 0.35;
	}

	.buttons {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.add {
		display: grid;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3) var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
	}

	.warn {
		display: grid;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--color-star);
		border-radius: var(--radius);
		background: color-mix(in srgb, var(--color-star) 12%, transparent);
	}

	.cancel {
		justify-self: start;
	}
</style>
