<!-- Search the library and pick a piece: for attaching a shared recording (and M5's Add child). -->
<script lang="ts">
	import { compareText, matchesSearch } from '#lib/domain/derived.ts';
	import { untitled } from '#lib/domain/format.ts';
	import type { Piece } from '#lib/domain/types.ts';
	import { library } from '#lib/store/library.svelte.ts';
	import KindBadge from './KindBadge.svelte';

	let {
		onpick,
		label = 'Find a piece',
		actionLabel = 'Choose',
		limit = 8
	}: {
		onpick: (piece: Piece) => void;
		label?: string;
		actionLabel?: string;
		limit?: number;
	} = $props();

	const uid = $props.id();
	let query = $state('');

	const results = $derived.by(() => {
		const index = library.index;
		if (!index || !query.trim()) return [];
		return index.live
			.filter((p) => matchesSearch(p, query))
			.sort((a, b) => compareText(a.title ?? '', b.title ?? ''))
			.slice(0, limit);
	});
</script>

<div class="picker">
	<label for="{uid}-q">{label}</label>
	<input id="{uid}-q" type="search" autocomplete="off" placeholder="Title" bind:value={query} />
	{#if query.trim()}
		{#if results.length === 0}
			<p class="muted">Nothing matches.</p>
		{:else}
			<ul aria-label="Matching pieces">
				{#each results as piece (piece.id)}
					{@const name = piece.title ?? untitled(piece.kind)}
					<li>
						<button
							type="button"
							class="btn-quiet"
							aria-label="{actionLabel} {name}"
							onclick={() => onpick(piece)}
						>
							<KindBadge kind={piece.kind} />
							<span class="name">{name}</span>
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
</div>

<style>
	.picker {
		display: grid;
		gap: var(--space-1);
	}

	label {
		font-weight: 600;
	}

	ul {
		display: grid;
		gap: var(--space-1);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li button {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		width: 100%;
		text-align: left;
	}

	.name {
		flex: 1;
		min-width: 0;
		overflow-wrap: anywhere;
	}

	p {
		margin: 0;
	}
</style>
