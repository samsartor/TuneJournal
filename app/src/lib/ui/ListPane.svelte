<script lang="ts">
	import { resolve } from '$app/paths';
	import { listPieces } from '#lib/domain/derived.ts';
	import { library } from '#lib/store/library.svelte.ts';
	import { theSession } from '#lib/store/thesession.svelte.ts';
	import FilterBar from './FilterBar.svelte';
	import PieceCard from './PieceCard.svelte';
	import SyncIndicator from './SyncIndicator.svelte';
	import { ui } from './state.svelte.ts';

	let { selectedId }: { selectedId?: string } = $props();

	let query = $state('');
	let dismissedDupes = $state<string>();

	const settings = $derived(library.doc?.settings.list);
	// thesession names and aliases from the integration cache, so search finds "The Tulla" too.
	const aliases = $derived(library.index ? theSession.aliasMap(library.index) : undefined);
	const pieces = $derived(
		library.index && settings
			? listPieces(library.index, { settings, query, now: ui.now, aliases })
			: []
	);
	const dupes = $derived(library.index?.duplicateTunes ?? []);
	// Dismissing hides the banner until the set of duplicates changes.
	const dupeKey = $derived(dupes.map((g) => g.pieces.map((p) => p.id).join(',')).join(';'));

	$effect(() => {
		// A throwaway collection, not state.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const ids = new Set<number>();
		for (const p of library.index?.live ?? []) {
			const tuneId = p.external?.thesession?.tuneId;
			if (tuneId !== undefined) ids.add(tuneId);
		}
		theSession.prime(ids);
	});
	const total = $derived(library.index?.live.length ?? 0);
</script>

<div class="list-pane">
	<header class="top">
		<h1>TuneJournal</h1>
		<div class="top-end">
			<SyncIndicator />
			<a class="icon-btn" href={resolve('/settings')} aria-label="Settings" title="Settings">⚙</a>
		</div>
	</header>

	<div class="toolbar">
		<input
			class="search"
			type="search"
			placeholder="Search titles and aliases"
			aria-label="Search"
			autocomplete="off"
			bind:value={query}
		/>
		<button type="button" class="wide-only" onclick={() => ui.addPiece()}>Add +</button>
		<a class="wide-only btn-link btn-quiet" href={resolve('/shuffle')}>Shuffle</a>
	</div>

	{#if library.status === 'ready' && settings && library.index}
		<FilterBar {settings} index={library.index} />

		{#if dupes.length > 0 && dismissedDupes !== dupeKey}
			{@const group = dupes[0]}
			<div class="banner" role="status">
				<span>
					{group.pieces.length} pieces are the same thesession tune{dupes.length > 1
						? ` (and ${dupes.length - 1} more ${dupes.length === 2 ? 'tune' : 'tunes'})`
						: ''}
				</span>
				<button
					type="button"
					class="btn-quiet"
					onclick={() => ui.openMerge(group.pieces.map((p) => p.id))}>Review</button
				>
				<button
					type="button"
					class="icon-btn"
					aria-label="Dismiss duplicate notice"
					onclick={() => (dismissedDupes = dupeKey)}>×</button
				>
			</div>
		{/if}

		<p class="count muted" aria-live="polite">
			{pieces.length === total
				? `${total} ${total === 1 ? 'piece' : 'pieces'}`
				: `${pieces.length} of ${total}`}
		</p>

		{#if total === 0}
			<div class="empty">
				<p>No tunes yet.</p>
				<p class="muted">Add your first with the + button.</p>
			</div>
		{:else if pieces.length === 0}
			<div class="empty">
				<p>Nothing matches.</p>
				<p class="muted">Try another search, or change the filters.</p>
			</div>
		{:else}
			<ul class="cards">
				{#each pieces as piece (piece.id)}
					<li>
						<PieceCard
							{piece}
							index={library.index}
							now={ui.now}
							selected={piece.id === selectedId}
						/>
					</li>
				{/each}
			</ul>
		{/if}
	{:else if library.status === 'error'}
		<p>Couldn’t open the library: {String(library.error)}</p>
	{:else}
		<p class="muted">Loading library…</p>
	{/if}

	<div class="fabs narrow-only">
		<button type="button" class="fab" aria-label="Add tune" onclick={() => ui.addPiece()}>+</button>
		<a class="fab secondary" href={resolve('/shuffle')} aria-label="Shuffle">⤮</a>
	</div>
</div>

<style>
	.list-pane {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-3);
		align-content: start;
		padding: var(--space-3);
		/* Room for the floating buttons on mobile. */
		padding-bottom: calc(6rem + env(safe-area-inset-bottom));
	}

	.top {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	h1 {
		margin: 0;
		font-size: 1.375rem;
		letter-spacing: -0.01em;
	}

	.top-end {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.top .icon-btn {
		text-decoration: none;
		border-radius: var(--radius);
	}

	.toolbar {
		display: flex;
		gap: var(--space-2);
	}

	.search {
		flex: 1;
		min-width: 0;
		padding: 0 var(--space-3);
		border-radius: 999px;
	}

	.btn-link {
		display: inline-grid;
		place-items: center;
		min-height: var(--touch);
		padding: 0 var(--space-3);
		border-radius: var(--radius);
		text-decoration: none;
	}

	.banner {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-1) var(--space-1) var(--space-1) var(--space-3);
		background: var(--color-accent-soft);
		border: 1px solid var(--color-accent);
		border-radius: var(--radius);
	}

	.banner span {
		flex: 1;
		min-width: 0;
	}

	.count {
		margin: 0;
		font-size: 0.875rem;
	}

	.cards {
		display: grid;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.empty {
		padding: var(--space-4) 0;
		text-align: center;
	}

	.empty p {
		margin: 0;
	}

	.fabs {
		position: fixed;
		left: calc(var(--space-3) + env(safe-area-inset-left));
		/* Above the player bar when one is showing, so they never overlap. */
		bottom: calc(var(--space-3) + env(safe-area-inset-bottom) + var(--player-h));
		z-index: 10;
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.fab {
		display: grid;
		place-items: center;
		width: 3.5rem;
		height: 3.5rem;
		padding: 0;
		border-radius: 50%;
		background: var(--color-accent);
		color: var(--color-on-accent);
		font-size: 1.75rem;
		line-height: 1;
		text-decoration: none;
		box-shadow: var(--shadow);
	}

	.fab.secondary {
		width: 3rem;
		height: 3rem;
		background: var(--color-surface);
		color: var(--color-accent);
		border: 1px solid var(--color-border);
		font-size: 1.375rem;
	}

	.wide-only {
		display: none;
	}

	@media (min-width: 52rem) {
		.list-pane {
			padding-bottom: var(--space-4);
		}

		.wide-only {
			display: inline-flex;
			align-items: center;
		}

		.narrow-only {
			display: none;
		}
	}
</style>
