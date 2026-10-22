<script lang="ts">
	// The 🔍 panel under the title in the edit modal (PLAN.md §6.3): search thesession.org, pick a
	// tune to fill title, type tag, tune id and link, then pick a setting, whose key and first notes
	// go on the thesession recording (§5). If the tune is already in the library, offer to open or
	// merge into it instead. The recording's Edit dialog reuses it to change the linked tune, or
	// (with `settingsOf`) just the setting.

	import { onDestroy, onMount } from 'svelte';
	import { foldText } from '#lib/domain/derived.ts';
	import { normalizeKey, formatKey } from '#lib/domain/key.ts';
	import { softDelete } from '#lib/domain/ops.ts';
	import { mergePieces } from '#lib/domain/relations.ts';
	import {
		applyTheSessionSetting,
		linkTheSessionTune,
		piecesWithTune,
		tuneUrl,
		typeTag
	} from '#lib/domain/thesession.ts';
	import type { Piece, PieceId } from '#lib/domain/types.ts';
	import {
		firstBars,
		type SearchHit,
		type Tune,
		type TuneSetting
	} from '#lib/integrations/thesession.ts';
	import { library } from '#lib/store/library.svelte.ts';
	import { loadErrorMessage, theSession } from '#lib/store/thesession.svelte.ts';
	import { ui } from './state.svelte.ts';

	let {
		pieceId,
		initialQuery,
		isNew,
		beforeApply,
		onapplied,
		onclose,
		onleave,
		settingsOf
	}: {
		pieceId: PieceId;
		initialQuery: string;
		isNew: boolean;
		/** Skip the search: pick another setting of this (already linked) tune. */
		settingsOf?: { tuneId: number; name: string };
		/** Saves pending text edits before the panel writes. */
		beforeApply: () => void;
		/** After a write, so the modal can refresh its local copies of text fields. */
		onapplied: () => void;
		onclose: () => void;
		/** Close the modal and show another piece. */
		onleave: (id: PieceId) => void;
	} = $props();

	const SEARCH_DELAY = 400;

	type Step =
		| { kind: 'results' }
		| { kind: 'confirm-title'; hit: SearchHit }
		| { kind: 'duplicate'; hit: SearchHit; existing: Piece[]; wasBlank: boolean }
		| { kind: 'settings'; hit: SearchHit; tune?: Tune; error?: string };

	// svelte-ignore state_referenced_locally
	let query = $state(initialQuery.trim());
	let results = $state.raw<SearchHit[]>();
	let searching = $state(false);
	let searchError = $state<string>();
	let step = $state.raw<Step>({ kind: 'results' });

	let timer: ReturnType<typeof setTimeout> | undefined;
	let latest = 0;
	let input = $state<HTMLInputElement>();

	const piece = $derived(library.doc?.pieces[pieceId]);
	const index = $derived(library.index);

	onDestroy(() => clearTimeout(timer));

	onMount(() => {
		if (settingsOf) {
			const { tuneId, name } = settingsOf;
			const hit: SearchHit = { id: tuneId, name, url: tuneUrl(tuneId), type: '', date: '' };
			void chooseSetting(hit, theSession.fetchTune(tuneId), true);
			return;
		}
		input?.focus();
		if (query) void search();
	});

	const currentSetting = $derived(piece?.external?.thesession?.settingId);

	async function search() {
		clearTimeout(timer);
		const q = query.trim();
		const ticket = ++latest;
		if (!q) {
			results = undefined;
			searching = false;
			return;
		}
		searching = true;
		searchError = undefined;
		try {
			const r = await theSession.search(q, (fresh) => {
				if (ticket === latest) results = fresh.tunes;
			});
			if (ticket === latest) results = r.tunes;
		} catch (e) {
			if (ticket === latest) searchError = loadErrorMessage(e);
		} finally {
			if (ticket === latest) searching = false;
		}
	}

	function oninput() {
		clearTimeout(timer);
		timer = setTimeout(search, SEARCH_DELAY);
	}

	function pick(hit: SearchHit) {
		if (!piece) return;
		if (piece.title && foldText(piece.title) !== foldText(hit.name)) {
			step = { kind: 'confirm-title', hit };
		} else {
			apply(hit, false);
		}
	}

	/** Nothing but (maybe) a title: safe to discard when the user opens an existing copy. */
	function isBlank(p: Piece): boolean {
		const linked = Object.values(library.doc?.links ?? {}).some(
			(l) => l.parent === p.id || l.child === p.id
		);
		return (
			!linked &&
			!p.description &&
			p.skill === undefined &&
			!p.favorite &&
			!p.key &&
			!p.firstNotes &&
			!p.external &&
			p.practice.length === 0 &&
			Object.keys(p.tags).length === 0 &&
			Object.keys(p.clips).length === 0
		);
	}

	function apply(hit: SearchHit, replaceTitle: boolean) {
		const doc = library.doc;
		if (!piece || !doc) return;
		beforeApply();
		const wasBlank = isBlank(piece);
		const existing = piecesWithTune(doc, hit.id).filter((p) => p.id !== pieceId);
		// Start loading the settings while the user reads the next step.
		const tune = theSession.fetchTune(hit.id);
		tune.catch(() => {});
		library.change((d) =>
			linkTheSessionTune(
				d,
				pieceId,
				{ tuneId: hit.id, name: hit.name, type: hit.type, url: hit.url },
				{ replaceTitle }
			)
		);
		onapplied();
		if (existing.length > 0) step = { kind: 'duplicate', hit, existing, wasBlank };
		else void chooseSetting(hit, tune);
	}

	async function chooseSetting(
		hit: SearchHit,
		pending = theSession.fetchTune(hit.id),
		/** Always show the list, even with one setting (changing the setting on purpose). */
		always = false
	) {
		step = { kind: 'settings', hit };
		let tune: Tune;
		try {
			tune = await pending;
		} catch (e) {
			step = { kind: 'settings', hit, error: loadErrorMessage(e) };
			return;
		}
		if (step.kind !== 'settings' || step.hit !== hit) return;
		if (tune.settings.length === 0) return onclose();
		if (tune.settings.length === 1 && !always) {
			// Nothing to choose: fill whatever is still blank.
			useSetting(tune.settings[0], false);
			return;
		}
		step = { kind: 'settings', hit, tune };
	}

	function useSetting(setting: TuneSetting, overwrite = true) {
		library.change((d) =>
			applyTheSessionSetting(
				d,
				pieceId,
				{ settingId: setting.id, key: setting.key, firstNotes: firstBars(setting.abc, 2) },
				{ overwrite }
			)
		);
		onapplied();
		onclose();
	}

	function openExisting(target: Piece, wasBlank: boolean) {
		// A new piece that holds nothing but this search is just a stray duplicate.
		if (isNew && wasBlank) library.change((d) => softDelete(d, pieceId));
		onleave(target.id);
	}

	function mergeInto(target: Piece) {
		const name = target.title ?? 'the existing tune';
		library.change((d) => mergePieces(d, target.id, pieceId));
		onleave(target.id);
		ui.showToast(`Merged into “${name}”`);
	}

	function settingKey(setting: TuneSetting): string {
		const key = normalizeKey(setting.key);
		return key ? formatKey(key) : setting.key;
	}
</script>

<div class="panel" role="group" aria-labelledby="ts-heading">
	<div class="panel-head">
		<h3 id="ts-heading">{settingsOf ? 'Pick a setting' : 'Search thesession.org'}</h3>
		<button
			type="button"
			class="icon-btn"
			aria-label="Close thesession.org search"
			onclick={onclose}>×</button
		>
	</div>

	{#if step.kind === 'results'}
		<div class="search-row">
			<input
				bind:this={input}
				type="search"
				aria-label="Tune name"
				autocomplete="off"
				bind:value={query}
				{oninput}
				onkeydown={(e) => {
					if (e.key === 'Enter') {
						e.preventDefault();
						void search();
					}
				}}
			/>
			<button type="button" onclick={search} disabled={!query.trim()}>Search</button>
		</div>
		<div aria-live="polite">
			{#if searchError}
				<p class="error">{searchError}</p>
			{:else if searching && !results}
				<p class="muted">Searching…</p>
			{:else if results && results.length === 0}
				<p class="muted">No tunes found on thesession.org.</p>
			{/if}
		</div>
		{#if results && results.length > 0}
			<ul class="results" aria-label="thesession.org results">
				{#each results as hit (hit.id)}
					{@const inLibrary = (index?.withTune(hit.id) ?? []).some((p) => p.id !== pieceId)}
					<li>
						<button type="button" class="result" onclick={() => pick(hit)}>
							<span class="name">{hit.name}</span>
							<span class="type">{typeTag(hit.type) ?? hit.type}</span>
							{#if hit.alias}<span class="alias muted">aka {hit.alias}</span>{/if}
							{#if inLibrary}<span class="chip in-lib">In library</span>{/if}
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	{:else if step.kind === 'confirm-title'}
		{@const hit = step.hit}
		<p>Replace the title “{piece?.title}” with “{hit.name}”?</p>
		<div class="buttons">
			<button type="button" onclick={() => apply(hit, true)}>Use “{hit.name}”</button>
			<button type="button" class="btn-quiet" onclick={() => apply(hit, false)}
				>Keep my title</button
			>
		</div>
	{:else if step.kind === 'duplicate'}
		{@const { hit, existing, wasBlank } = step}
		{@const target = existing[0]}
		<p role="alert">
			“{target.title ?? hit.name}” is already in your library{existing.length > 1
				? ` (${existing.length} pieces)`
				: ''}.
		</p>
		<div class="buttons">
			<button type="button" onclick={() => openExisting(target, wasBlank)}>Open existing</button>
			<button type="button" class="btn-quiet" onclick={() => mergeInto(target)}
				>Merge into existing</button
			>
			<button type="button" class="btn-quiet" onclick={() => chooseSetting(hit)}>Keep both</button>
		</div>
	{:else if step.kind === 'settings'}
		{#if step.error}
			<p class="error">Linked to “{step.hit.name}”, but couldn’t load its settings. {step.error}</p>
			<div class="buttons">
				<button type="button" class="btn-quiet" onclick={onclose}>Done</button>
			</div>
		{:else if !step.tune}
			<p class="muted" aria-live="polite">Loading settings…</p>
		{:else}
			<p id="ts-settings-label">
				“{step.tune.name}” has {step.tune.settings.length}
				{step.tune.settings.length === 1 ? 'setting' : 'settings'}. Pick one for the key and first
				notes.
			</p>
			<ul class="results settings" aria-labelledby="ts-settings-label">
				{#each step.tune.settings as setting, i (setting.id)}
					<li>
						<button
							type="button"
							class="result"
							aria-label="Setting {i + 1}, {settingKey(setting)}: {firstBars(setting.abc, 2)}"
							aria-current={setting.id === currentSetting ? 'true' : undefined}
							onclick={() => useSetting(setting)}
						>
							<span class="name">Setting {i + 1}</span>
							{#if setting.id === currentSetting}<span class="chip">Current</span>{/if}
							<span class="type">{settingKey(setting)}</span>
							<span class="abc">{firstBars(setting.abc, 2)}</span>
						</button>
					</li>
				{/each}
			</ul>
			<div class="buttons">
				<button type="button" class="btn-quiet" onclick={onclose}
					>{settingsOf ? 'Cancel' : 'Skip'}</button
				>
			</div>
		{/if}
	{/if}
</div>

<style>
	.panel {
		display: grid;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3) var(--space-3);
		background: var(--color-surface);
		border: 1px solid var(--color-accent);
		border-radius: var(--radius);
	}

	.panel-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	h3 {
		margin: 0;
		font-size: 1rem;
	}

	p {
		margin: 0;
	}

	.search-row {
		display: flex;
		gap: var(--space-2);
	}

	.search-row input {
		flex: 1;
		min-width: 0;
	}

	.results {
		display: grid;
		gap: var(--space-1);
		max-height: 22rem;
		overflow-y: auto;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.result {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0 var(--space-2);
		width: 100%;
		padding: var(--space-2);
		text-align: left;
		background: var(--color-bg);
		color: var(--color-text);
		border: 1px solid var(--color-border);
	}

	@media (hover: hover) {
		.result:hover {
			border-color: var(--color-accent);
		}
	}

	.result[aria-current='true'] {
		border-color: var(--color-accent);
	}

	.name {
		font-weight: 600;
	}

	.type {
		color: var(--color-accent);
		font-size: 0.875rem;
	}

	.alias {
		font-size: 0.875rem;
	}

	.in-lib {
		margin-left: auto;
	}

	.abc {
		flex-basis: 100%;
		font-family: var(--font-mono);
		font-size: 0.875rem;
		overflow-wrap: anywhere;
	}

	.buttons {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.error {
		color: var(--color-danger);
	}
</style>
