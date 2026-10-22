<script lang="ts">
	// What thesession.org knows about a linked tune (PLAN.md §6.4, §7): aliases, type, settings,
	// counts, and the sets it appears in, which can be promoted into Set pieces. All of it comes
	// from the integration cache, so it's shown offline once it has been loaded.

	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { formatKey, normalizeKey } from '#lib/domain/key.ts';
	import { pieceForSet, promoteTheSessionSet, typeTag } from '#lib/domain/thesession.ts';
	import type { PieceId } from '#lib/domain/types.ts';
	import type { TuneSet } from '#lib/integrations/thesession.ts';
	import { library } from '#lib/store/library.svelte.ts';
	import { loadErrorMessage, theSession } from '#lib/store/thesession.svelte.ts';
	import { ui } from './state.svelte.ts';

	let { tuneId }: { tuneId: number } = $props();

	const tune = $derived(theSession.tune(tuneId));
	const sets = $derived(theSession.sets(tuneId));
	const index = $derived(library.index);
	const numbers = new Intl.NumberFormat();

	/** Distinct keys across settings, most common first: "E dor ×29". */
	const keys = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a throwaway tally, not state
		const counts = new Map<string, number>();
		for (const s of tune.data?.settings ?? []) {
			const k = normalizeKey(s.key);
			const label = k ? formatKey(k) : s.key;
			counts.set(label, (counts.get(label) ?? 0) + 1);
		}
		return [...counts].sort((a, b) => b[1] - a[1]);
	});

	function promote(set: TuneSet) {
		const result = library.change((d) =>
			promoteTheSessionSet(d, {
				setId: set.id,
				url: set.url,
				tunes: set.tunes.map((t) => ({
					tuneId: t.tuneId,
					name: t.name,
					type: t.type,
					settingId: t.settingId,
					key: t.key
				}))
			})
		);
		ui.now = Date.now();
		const n = result.created.length;
		ui.showToast(`Added a set of ${result.tunes.length} tunes${n > 0 ? ` (${n} new)` : ''}`, {
			label: 'Open',
			run: () => open(result.setId)
		});
	}

	function open(id: PieceId) {
		void goto(resolve('/(main)/piece/[id]', { id }));
	}
</script>

<section aria-labelledby="ts-info-heading">
	<h2 id="ts-info-heading">thesession.org</h2>
	{#if tune.data}
		{@const t = tune.data}
		<div class="info">
			{#if t.aliases.length > 0}
				<p data-testid="aliases">
					<span class="muted">Also known as</span>
					{t.aliases.join(' · ')}
				</p>
			{/if}
			<dl class="facts">
				<div>
					<dt>Type</dt>
					<dd>{typeTag(t.type) ?? t.type}</dd>
				</div>
				<div>
					<dt>Settings</dt>
					<dd>
						{t.settings.length}
						{#if keys.length > 0}
							<span class="muted"
								>({keys.map(([k, n]) => (keys.length > 1 ? `${k} ×${n}` : k)).join(', ')})</span
							>
						{/if}
					</dd>
				</div>
				<div>
					<dt>Tunebooks</dt>
					<dd>{numbers.format(t.tunebooks)}</dd>
				</div>
				<div>
					<dt>Recordings</dt>
					<dd>{numbers.format(t.recordings)}</dd>
				</div>
			</dl>
		</div>
	{:else if tune.loading}
		<p class="muted">Loading from thesession.org…</p>
	{:else if tune.error}
		<p class="muted">{loadErrorMessage(tune.error)}</p>
	{/if}

	<h3 id="ts-sets-heading">Appears in sets</h3>
	{#if sets.data}
		{@const list = sets.data.sets.slice(0, 10)}
		{#if list.length === 0}
			<p class="muted">Not in any sets on thesession.org yet.</p>
		{:else}
			<ul class="sets" aria-labelledby="ts-sets-heading">
				{#each list as set (set.id)}
					{@const existing = library.doc ? pieceForSet(library.doc, set.id) : undefined}
					<li class="set">
						<ol class="set-tunes" aria-label="Tunes in this set">
							{#each set.tunes as entry, i (i)}
								{@const owned = index?.withTune(entry.tuneId)[0]}
								<li class:owned={!!owned}>
									{#if owned}
										<a href={resolve('/(main)/piece/[id]', { id: owned.id })}>{entry.name}</a>
										<span class="mark" aria-hidden="true" title="In your library">✓</span>
										<span class="visually-hidden">(in library)</span>
									{:else}
										{entry.name}
									{/if}
								</li>
							{/each}
						</ol>
						<div class="set-actions">
							{#if existing}
								<a
									class="btn-link btn-quiet"
									href={resolve('/(main)/piece/[id]', { id: existing.id })}>Open set</a
								>
							{:else}
								<button type="button" class="btn-quiet" onclick={() => promote(set)}
									>Add to library</button
								>
							{/if}
						</div>
					</li>
				{/each}
			</ul>
			{#if sets.data.total > list.length}
				<p class="muted small">
					{numbers.format(sets.data.total)} sets in all on
					<a
						href="https://thesession.org/tunes/{tuneId}/sets"
						target="_blank"
						rel="noopener noreferrer">thesession.org ↗</a
					>
				</p>
			{/if}
		{/if}
	{:else if sets.loading}
		<p class="muted">Loading sets…</p>
	{:else if sets.error}
		<p class="muted">{loadErrorMessage(sets.error)}</p>
	{/if}
</section>

<style>
	section {
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
		margin: var(--space-2) 0 0;
		font-size: 1rem;
	}

	p {
		margin: 0;
	}

	.info {
		display: grid;
		gap: var(--space-2);
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

	.sets {
		display: grid;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.set {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
	}

	.set-tunes {
		flex: 1 1 14rem;
		display: flex;
		flex-wrap: wrap;
		gap: 0 var(--space-1);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.set-tunes li:not(:last-child)::after {
		content: ' /';
		color: var(--color-muted);
	}

	.owned {
		font-weight: 600;
	}

	.mark {
		color: var(--color-accent);
	}

	.btn-link {
		display: inline-grid;
		place-items: center;
		min-height: var(--touch);
		padding: 0 var(--space-3);
		border-radius: var(--radius);
		text-decoration: none;
	}

	.small {
		font-size: 0.875rem;
	}
</style>
