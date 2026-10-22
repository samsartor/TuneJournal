<!--
	Search the library and pick a piece: for attaching a shared recording, Add child and "Merge
	with…". With `oncreate` it also offers "New <kind>", titled with the search text.
-->
<script lang="ts">
	import { compareText, matchesSearch } from '#lib/domain/derived.ts';
	import { untitled } from '#lib/domain/format.ts';
	import type { Piece, PieceId } from '#lib/domain/types.ts';
	import { library } from '#lib/store/library.svelte.ts';
	import KindBadge from './KindBadge.svelte';

	let {
		onpick,
		label = 'Find a piece',
		actionLabel = 'Choose',
		limit = 8,
		exclude,
		oncreate,
		createLabel = 'New',
		autofocus = false
	}: {
		onpick: (piece: Piece) => void;
		label?: string;
		actionLabel?: string;
		limit?: number;
		/** Pieces not to offer (the piece itself, ones already linked, …). */
		exclude?: ReadonlySet<PieceId>;
		/** Offers a "New …" button; gets the trimmed search text as the title. */
		oncreate?: (title: string) => void;
		/** "New Part", say; the search text is appended when there is some. */
		createLabel?: string;
		autofocus?: boolean;
	} = $props();

	const uid = $props.id();
	let query = $state('');

	const results = $derived.by(() => {
		const index = library.index;
		if (!index || !query.trim()) return [];
		return index.live
			.filter((p) => !exclude?.has(p.id) && matchesSearch(p, query))
			.sort((a, b) => compareText(a.title ?? '', b.title ?? ''))
			.slice(0, limit);
	});
</script>

<div class="picker">
	<label for="{uid}-q">{label}</label>
	<!-- svelte-ignore a11y_autofocus -->
	<input
		id="{uid}-q"
		type="search"
		autocomplete="off"
		placeholder="Title"
		{autofocus}
		bind:value={query}
	/>
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
	{#if oncreate}
		<button type="button" class="btn-quiet create" onclick={() => oncreate(query.trim())}>
			+ {createLabel}{query.trim() ? ` “${query.trim()}”` : ''}
		</button>
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

	.create {
		justify-self: start;
		overflow-wrap: anywhere;
		text-align: left;
	}
</style>
