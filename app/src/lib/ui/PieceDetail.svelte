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
	import Recordings from './Recordings.svelte';
	import Related from './Related.svelte';
	import SkillSlider from './SkillSlider.svelte';
	import TheSessionInfo from './TheSessionInfo.svelte';
	import { originName } from './origin.ts';
	import { ui } from './state.svelte.ts';

	let { id }: { id: PieceId } = $props();

	const index = $derived(library.index);
	const piece = $derived(library.doc?.pieces[id]);
	const name = $derived(piece ? (piece.title ?? untitled(piece.kind)) : '');
	const history = $derived(piece && index ? index.effectivePractice(piece) : []);
	const stats = $derived(piece && index ? index.stats(piece) : undefined);
	// Key and first notes: the piece's own, else a recording's, else (key only) a Part's Tune's (§5).
	const keyInfo = $derived(piece && index ? index.keyOf(piece) : undefined);
	const notesInfo = $derived(piece && index ? index.firstNotesOf(piece) : undefined);
	const tags = $derived(piece && index ? index.tagsOf(piece) : []);
	const tuneId = $derived(piece?.external?.thesession?.tuneId);
	// A Part with no skill or key of its own uses its Tune's (§5).
	const tune = $derived(piece && index ? index.inheritsFrom(piece) : undefined);
	const tuneName = $derived(tune ? (tune.title ?? untitled(tune.kind)) : '');
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

	/** Straight back through history, so Back from Shuffle afterwards still leaves Shuffle. */
	function backToShuffle(e: MouseEvent) {
		if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
		e.preventDefault();
		window.history.back();
	}

	async function remove() {
		ui.delete(id);
		await goto(resolve('/(main)'));
	}
</script>

<article class="detail">
	<nav class="bar">
		{#if ui.shuffleReturn?.id === id}
			<!-- Opened from Shuffle: back to the same card (its URL carries seed, start and index). -->
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- built with resolve() -->
			<a class="back-shuffle" href={ui.shuffleReturn.href} onclick={backToShuffle}>← Shuffle</a>
		{:else}
			<a class="back" href={resolve('/(main)')}>← All pieces</a>
		{/if}
		{#if piece && !piece.deletedAt}
			<div class="bar-actions">
				<button type="button" class="btn-quiet" onclick={() => ui.openEdit(id)}>Edit</button>
				<Menu
					label="More actions for {name}"
					items={[
						{ label: 'Merge with…', run: () => ui.openMergePicker(id) },
						{ label: 'Delete', run: remove, danger: true }
					]}
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
					<dd class:inherited={keyInfo && keyInfo.origin.from !== 'own'} data-testid="key">
						{keyInfo ? formatKey(keyInfo.value) : '—'}
						{#if keyInfo?.origin.from === 'tune'}
							<span class="from"
								>from <a href={resolve('/(main)/piece/[id]', { id: keyInfo.origin.tune.id })}
									>{originName(keyInfo.origin)}</a
								></span
							>
						{:else if keyInfo?.origin.from === 'clip'}
							<span class="from">from {originName(keyInfo.origin)}</span>
						{/if}
					</dd>
				</div>
				<div>
					<dt>First notes</dt>
					<dd
						class="abc"
						class:inherited={notesInfo && notesInfo.origin.from !== 'own'}
						data-testid="first-notes"
					>
						{notesInfo?.value ?? '—'}
						{#if notesInfo && notesInfo.origin.from !== 'own'}
							<span class="from">from {originName(notesInfo.origin)}</span>
						{/if}
					</dd>
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
			<SkillSlider
				skill={piece.skill}
				inherited={tune ? { skill: tune.skill, from: tuneName } : undefined}
				onchange={setSkill}
				id="detail-skill"
			/>
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

		<Recordings {piece} />

		{#if tuneId !== undefined}
			{#key tuneId}<TheSessionInfo {tuneId} />{/key}
		{/if}

		{#if !piece.deletedAt}<Related {piece} />{/if}

		<section aria-labelledby="history-heading">
			<h2 id="history-heading">Practice history</h2>
			{#if history.length > 0}
				<ol class="history">
					{#each history as entry, i (i)}
						<li>
							<time datetime={new Date(entry.at).toISOString()}>{dateFormat.format(entry.at)}</time>
							{#if entry.viaPiece}
								{@const via = index?.get(entry.viaPiece)}
								<span class="via"
									>via <a href={resolve('/(main)/piece/[id]', { id: entry.viaPiece })}
										>{via ? (via.title ?? untitled(via.kind)) : 'another piece'}</a
									></span
								>
							{/if}
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

	.back,
	.back-shuffle {
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

	dd.inherited {
		color: var(--color-muted);
		font-weight: 500;
	}

	.from {
		font-family: var(--font-sans);
		font-size: 0.875rem;
		font-style: italic;
	}

	.via {
		flex: 1;
		color: var(--color-muted);
		font-size: 0.9375rem;
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
