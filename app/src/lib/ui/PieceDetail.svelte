<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { hasKey } from '#lib/domain/derived.ts';
	import { KIND_LABEL, relativeTime, untitled } from '#lib/domain/format.ts';
	import { formatKey } from '#lib/domain/key.ts';
	import { undoDelete, updatePiece } from '#lib/domain/ops.ts';
	import type { PieceId, Skill } from '#lib/domain/types.ts';
	import { library } from '#lib/store/library.svelte.ts';
	import KindBadge from './KindBadge.svelte';
	import Menu from './Menu.svelte';
	import SkillSlider from './SkillSlider.svelte';
	import TheSessionInfo from './TheSessionInfo.svelte';
	import { ui } from './state.svelte.ts';

	let { id }: { id: PieceId } = $props();

	const index = $derived(library.index);
	const piece = $derived(library.doc?.pieces[id]);
	const name = $derived(piece ? (piece.title ?? untitled(piece.kind)) : '');
	const history = $derived(piece && index ? index.effectivePractice(piece) : []);
	const stats = $derived(piece && index ? index.stats(piece) : undefined);
	const key = $derived(piece && index ? index.effectiveKey(piece) : undefined);
	const tags = $derived(piece && index ? index.tagsOf(piece) : []);
	const tuneId = $derived(piece?.external?.thesession?.tuneId);
	const parents = $derived(piece && index ? index.parents(piece) : []);
	const children = $derived(piece && index ? index.children(piece) : []);
	/** Clips that are only links out (thesession for now); playable recordings arrive in M4. */
	const links = $derived.by(() => {
		if (!piece || !library.doc) return [];
		const sources = library.doc.sources;
		return Object.values(piece.clips)
			.sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
			.map((clip) => ({ clip, source: sources[clip.sourceId] }))
			.filter(({ source }) => source?.provider === 'thesession');
	});

	// A piece merged into another redirects there (§6.4), following chains of merges.
	$effect(() => {
		if (!piece?.mergedInto || !index) return;
		const target = index.resolve(id);
		if (target && target.id !== id) {
			void goto(resolve('/(main)/piece/[id]', { id: target.id }), { replaceState: true });
		}
	});

	const dateFormat = new Intl.DateTimeFormat(undefined, {
		weekday: 'short',
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit'
	});

	function setSkill(skill: Skill | null) {
		library.change((d) => updatePiece(d, id, { skill }));
	}

	function toggleFavorite() {
		if (piece) library.change((d) => updatePiece(d, id, { favorite: !piece.favorite }));
	}

	async function remove() {
		ui.delete(id);
		await goto(resolve('/(main)'));
	}
</script>

<article class="detail">
	<nav class="bar">
		<a class="back" href={resolve('/(main)')}>← All pieces</a>
		{#if piece && !piece.deletedAt}
			<div class="bar-actions">
				<button type="button" class="btn-quiet" onclick={() => ui.openEdit(id)}>Edit</button>
				<Menu
					label="More actions for {name}"
					items={[{ label: 'Delete', run: remove, danger: true }]}
				/>
			</div>
		{/if}
	</nav>

	{#if library.status !== 'ready'}
		<p class="muted">Loading…</p>
	{:else if !piece}
		<h1>Not found</h1>
		<p class="muted">This piece isn’t in your library.</p>
	{:else}
		{#if piece.mergedInto}
			{@const target = index?.resolve(id)}
			<div class="deleted" role="status">
				<span>
					This {KIND_LABEL[piece.kind].toLowerCase()} was merged{#if target && target.id !== id}
						into <a href={resolve('/(main)/piece/[id]', { id: target.id })}
							>{target.title ?? untitled(target.kind)}</a
						>{/if}.
				</span>
			</div>
		{:else if piece.deletedAt}
			<div class="deleted" role="status">
				<span>This {KIND_LABEL[piece.kind].toLowerCase()} was deleted.</span>
				<button type="button" onclick={() => library.change((d) => undoDelete(d, id))}
					>Restore</button
				>
			</div>
		{/if}

		<header class="head">
			<KindBadge kind={piece.kind} />
			<h1 class:muted={!piece.title}>{name}</h1>
			<button
				type="button"
				class="icon-btn star"
				class:on={piece.favorite}
				aria-label="Favorite"
				aria-pressed={piece.favorite}
				onclick={toggleFavorite}>{piece.favorite ? '★' : '☆'}</button
			>
		</header>

		{#if hasKey(piece)}
			<dl class="facts">
				<div>
					<dt>Key</dt>
					<dd>{key ? formatKey(key) : '—'}</dd>
				</div>
				<div>
					<dt>First notes</dt>
					<dd class="abc">{piece.firstNotes ?? '—'}</dd>
				</div>
			</dl>
		{/if}

		<div class="practice-row">
			<button type="button" class="practiced" onclick={() => ui.practice(id)}>Practiced ✓</button>
			<p class="muted" data-testid="last-practiced">
				{#if stats?.lastPracticed !== undefined}
					Last practiced {relativeTime(stats.lastPracticed, ui.now)} · {stats.timesPracticed}
					{stats.timesPracticed === 1 ? 'time' : 'times'}
				{:else}
					Never practiced
				{/if}
			</p>
		</div>

		<section>
			<SkillSlider skill={index?.effectiveSkill(piece)} onchange={setSkill} id="detail-skill" />
		</section>

		<section>
			<h2>Description</h2>
			{#if piece.description}
				<p class="description">{piece.description}</p>
			{:else}
				<p class="muted">No description.</p>
			{/if}
		</section>

		<section>
			<h2>Tags</h2>
			{#if tags.length > 0}
				<ul class="tags">
					{#each tags as tag (tag)}<li class="chip">{tag}</li>{/each}
				</ul>
			{:else}
				<p class="muted">No tags.</p>
			{/if}
		</section>

		<section>
			<h2>Recordings</h2>
			{#if links.length > 0}
				<ul class="links">
					{#each links as { clip, source } (clip.id)}
						<li>
							<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
							<a href={source.url} target="_blank" rel="noopener noreferrer">thesession.org ↗</a>
						</li>
					{/each}
				</ul>
			{/if}
			<p class="placeholder muted">Audio recordings arrive in a later version.</p>
		</section>

		{#if tuneId !== undefined}
			{#key tuneId}<TheSessionInfo {tuneId} />{/key}
		{/if}

		<section aria-labelledby="related-heading">
			<h2 id="related-heading">Related</h2>
			{#if parents.length === 0 && children.length === 0}
				<p class="muted">Not part of any set, and has no parts.</p>
			{/if}
			{#if parents.length > 0}
				<h3 id="parents-heading">Part of</h3>
				<ul class="related" aria-labelledby="parents-heading">
					{#each parents as { piece: other } (other.id)}
						<li>
							<KindBadge kind={other.kind} />
							<a href={resolve('/(main)/piece/[id]', { id: other.id })}
								>{other.title ?? untitled(other.kind)}</a
							>
						</li>
					{/each}
				</ul>
			{/if}
			{#if children.length > 0}
				<h3 id="children-heading">Contains</h3>
				<ol class="related" aria-labelledby="children-heading">
					{#each children as { piece: other } (other.id)}
						<li>
							<KindBadge kind={other.kind} />
							<a href={resolve('/(main)/piece/[id]', { id: other.id })}
								>{other.title ?? untitled(other.kind)}</a
							>
						</li>
					{/each}
				</ol>
			{/if}
		</section>

		<section>
			<h2>Practice history</h2>
			{#if history.length > 0}
				<ol class="history">
					{#each history as entry, i (i)}
						<li>
							<time datetime={new Date(entry.at).toISOString()}>{dateFormat.format(entry.at)}</time>
							<span class="muted">{relativeTime(entry.at, ui.now)}</span>
						</li>
					{/each}
				</ol>
			{:else}
				<p class="muted">Not practiced yet.</p>
			{/if}
		</section>
	{/if}
</article>

<style>
	.detail {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-4);
		align-content: start;
		max-width: 44rem;
		padding: var(--space-3);
		padding-bottom: calc(var(--space-4) * 2 + env(safe-area-inset-bottom));
	}

	.bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}

	.back {
		display: inline-flex;
		align-items: center;
		min-height: var(--touch);
		text-decoration: none;
		font-weight: 600;
	}

	.bar-actions {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		margin-left: auto;
	}

	.deleted {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-2) var(--space-2) var(--space-3);
		border: 1px solid var(--color-danger);
		border-radius: var(--radius);
	}

	.head {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	h1 {
		flex: 1;
		margin: 0;
		font-size: 1.75rem;
		line-height: 1.2;
		overflow-wrap: anywhere;
	}

	h1.muted {
		font-style: italic;
		font-weight: 500;
	}

	h2 {
		margin: 0 0 var(--space-2);
		font-size: 0.8125rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--color-muted);
	}

	section > p {
		margin: 0;
	}

	.star {
		font-size: 1.75rem;
	}

	.star.on {
		color: var(--color-star);
	}

	.facts {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2) var(--space-4);
		margin: 0;
	}

	dt {
		font-size: 0.8125rem;
		color: var(--color-muted);
	}

	dd {
		margin: 0;
		font-weight: 600;
	}

	.abc {
		font-family: var(--font-mono);
		font-weight: 400;
	}

	.practice-row {
		display: grid;
		gap: var(--space-2);
	}

	.practice-row p {
		margin: 0;
	}

	.practiced {
		min-height: 52px;
		font-size: 1.0625rem;
		font-weight: 600;
	}

	.description {
		white-space: pre-wrap;
	}

	.tags {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	h3 {
		margin: var(--space-2) 0 var(--space-1);
		font-size: 1rem;
	}

	.links,
	.related {
		display: grid;
		gap: var(--space-1);
		margin: 0 0 var(--space-2);
		padding: 0;
		list-style: none;
	}

	.links a,
	.related a {
		display: inline-flex;
		align-items: center;
		min-height: var(--touch);
	}

	.related li {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.placeholder {
		padding: var(--space-3);
		border: 1px dashed var(--color-border);
		border-radius: var(--radius);
	}

	.history {
		display: grid;
		gap: var(--space-1);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.history li {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: var(--space-2);
		padding: var(--space-2) 0;
		border-bottom: 1px solid var(--color-border);
	}

	@media (min-width: 52rem) {
		.detail {
			padding: var(--space-4);
		}

		.back {
			display: none;
		}

		.practice-row {
			grid-template-columns: auto 1fr;
			align-items: center;
		}

		.practiced {
			padding: 0 var(--space-4);
		}
	}
</style>
