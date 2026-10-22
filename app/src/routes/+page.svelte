<script lang="ts">
	import { library } from '#lib/store/library.svelte.ts';

	const pieceCount = $derived(
		library.doc ? Object.values(library.doc.pieces).filter((p) => !p.deletedAt).length : 0
	);
</script>

<main>
	<h1>TuneJournal</h1>

	{#if library.status === 'ready'}
		<p>{pieceCount} {pieceCount === 1 ? 'piece' : 'pieces'}</p>
		<p class="muted">Library <code>{library.url}</code></p>
	{:else if library.status === 'error'}
		<p>Couldn't open the library: {String(library.error)}</p>
	{:else}
		<p class="muted">Loading library…</p>
	{/if}
</main>

<style>
	main {
		max-width: 40rem;
		margin: 0 auto;
		padding: var(--space-4) var(--space-3);
	}

	.muted {
		color: var(--color-muted);
	}
</style>
