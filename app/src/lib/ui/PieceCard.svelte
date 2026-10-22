<script lang="ts">
	import { resolve } from '$app/paths';
	import { hasKey, type LibraryIndex } from '#lib/domain/derived.ts';
	import { relativeTime, untitled } from '#lib/domain/format.ts';
	import { formatKey } from '#lib/domain/key.ts';
	import { updatePiece } from '#lib/domain/ops.ts';
	import type { Piece } from '#lib/domain/types.ts';
	import { library } from '#lib/store/library.svelte.ts';
	import KindBadge from './KindBadge.svelte';
	import { PROVIDERS } from '#lib/domain/providers.ts';
	import Menu from './Menu.svelte';
	import ProviderIcon from './ProviderIcon.svelte';
	import SkillDots from './SkillDots.svelte';
	import { ui } from './state.svelte.ts';

	let {
		piece,
		index,
		now,
		selected = false
	}: { piece: Piece; index: LibraryIndex; now: number; selected?: boolean } = $props();

	const name = $derived(piece.title ?? untitled(piece.kind));
	const stats = $derived(index.stats(piece));
	const key = $derived(index.effectiveKey(piece));
	const tags = $derived(index.tagsOf(piece));
	const providers = $derived(index.providersOf(piece));

	function toggleFavorite() {
		library.change((d) => updatePiece(d, piece.id, { favorite: !piece.favorite }));
	}
</script>

<article class="card" class:selected aria-label={name}>
	<div class="head">
		<KindBadge kind={piece.kind} />
		<h2 class="title" class:muted={!piece.title}>
			<a
				href={resolve('/(main)/piece/[id]', { id: piece.id })}
				aria-current={selected ? 'page' : undefined}>{name}</a
			>
		</h2>
		<button
			type="button"
			class="icon-btn star"
			class:on={piece.favorite}
			aria-label="Favorite"
			aria-pressed={piece.favorite}
			onclick={toggleFavorite}>{piece.favorite ? '★' : '☆'}</button
		>
	</div>

	<div class="meta">
		{#if key && hasKey(piece)}<span class="key">{formatKey(key)}</span>{/if}
		<SkillDots skill={index.effectiveSkill(piece)} />
		<span class="last" data-testid="last-practiced">
			{stats.lastPracticed === undefined
				? 'Never practiced'
				: `Last practiced ${relativeTime(stats.lastPracticed, now)}`}
		</span>
		{#if providers.length > 0}
			<span
				class="providers"
				role="img"
				aria-label="Recordings: {providers.map((p) => PROVIDERS[p].label).join(', ')}"
			>
				{#each providers as provider (provider)}<ProviderIcon {provider} label={false} />{/each}
			</span>
		{/if}
	</div>

	{#if tags.length > 0}
		<ul class="tags" aria-label="Tags">
			{#each tags as tag (tag)}<li class="chip">{tag}</li>{/each}
		</ul>
	{/if}

	<div class="actions">
		<button type="button" class="practiced" onclick={() => ui.practice(piece.id)}>
			Practiced ✓
		</button>
		<Menu
			label="More actions for {name}"
			items={[
				{ label: 'Edit', run: () => ui.openEdit(piece.id) },
				{ label: 'Delete', run: () => ui.delete(piece.id), danger: true }
			]}
		/>
	</div>
</article>

<style>
	.card {
		position: relative;
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-2);
		padding: var(--space-3);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
	}

	@media (hover: hover) {
		.card:hover {
			border-color: color-mix(in srgb, var(--color-accent) 40%, var(--color-border));
		}
	}

	.card.selected {
		border-color: var(--color-accent);
		box-shadow: inset 3px 0 0 var(--color-accent);
	}

	.head {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin: calc(-1 * var(--space-2)) 0;
	}

	.title {
		flex: 1;
		min-width: 0;
		margin: 0;
		font-size: 1.125rem;
		font-weight: 600;
		line-height: 1.3;
		overflow-wrap: anywhere;
	}

	.title a {
		color: inherit;
		text-decoration: none;
	}

	/* The title link covers the card, so tapping anywhere opens the detail view. */
	.title a::after {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: var(--radius);
	}

	.title.muted a {
		font-style: italic;
		font-weight: 500;
	}

	.star,
	.actions,
	.tags {
		position: relative;
		z-index: 1;
	}

	.star {
		margin-right: calc(-1 * var(--space-2));
		font-size: 1.5rem;
	}

	.star.on {
		color: var(--color-star);
	}

	.meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1) var(--space-3);
		color: var(--color-muted);
		font-size: 0.9375rem;
	}

	.providers {
		display: inline-flex;
		gap: 0.2rem;
	}

	.key {
		color: var(--color-text);
		font-weight: 600;
	}

	.tags {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
		margin: 0;
		padding: 0;
		list-style: none;
		pointer-events: none;
	}

	.actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		pointer-events: none;
	}

	.actions > :global(*) {
		pointer-events: auto;
	}

	/* Softer than a solid button, so a long list stays calm. */
	.practiced {
		flex: 1;
		min-height: 48px;
		font-weight: 600;
		background: var(--color-accent-soft);
		color: var(--color-accent);
	}

	.practiced:active {
		background: var(--color-accent);
		color: var(--color-on-accent);
	}
</style>
