<!--
	The thesession.org tune and setting picker (PLAN.md §6.3): a view of its own that covers the
	dialog it was opened from (full screen on a phone, a modal in its place on a desktop). × or
	Escape (or Android's back gesture, through the dialog's close watcher) goes back to that dialog.

	Search for a tune and pick one to fill the title, type tag, tune id and link, then pick a
	setting, whose key and first notes go on the thesession recording (§5). If the tune is already
	in the library, it offers to open or merge into it instead. With `settingsOf` it skips the
	search and just picks another setting of the linked tune. Tunes and settings can be previewed,
	synthesized, before choosing (audio/preview.svelte.ts); a preview stops when the picker closes.
-->
<script lang="ts">
	import { onDestroy, onMount, tick } from 'svelte';
	import { preview } from '#lib/audio/preview.svelte.ts';
	import { foldText } from '#lib/domain/derived.ts';
	import { softDelete } from '#lib/domain/ops.ts';
	import { mergePieces } from '#lib/domain/relations.ts';
	import type { SynthTarget } from '#lib/domain/synth.ts';
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
	import Incipit from './Incipit.svelte';
	import SpeedControl from './SpeedControl.svelte';
	import {
		incipitAbc,
		otherNames,
		postedBy,
		settingKeyLabel,
		tuneSummary,
		typeMeter
	} from './picker.ts';
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
		/** Saves pending text edits before the picker writes. */
		beforeApply: () => void;
		/** After a write, so the dialog underneath can refresh its local copies of text fields. */
		onapplied: () => void;
		/** Back to the dialog underneath. */
		onclose: () => void;
		/** Close the dialog underneath too, and show another piece. */
		onleave: (id: PieceId) => void;
	} = $props();

	const uid = $props.id();
	const SEARCH_DELAY = 400;

	type Step =
		| { kind: 'results' }
		| { kind: 'confirm-title'; hit: SearchHit }
		| { kind: 'duplicate'; hit: SearchHit; existing: Piece[]; wasBlank: boolean }
		| { kind: 'settings'; hit: SearchHit; tune?: Tune; error?: string };

	let dialog: HTMLDialogElement;
	let input = $state<HTMLInputElement>();
	let heading = $state<HTMLElement>();

	// svelte-ignore state_referenced_locally
	let query = $state(initialQuery.trim());
	let results = $state.raw<SearchHit[]>();
	let searching = $state(false);
	let searchError = $state<string>();
	let step = $state.raw<Step>({ kind: 'results' });
	/** Set when closing to show another piece rather than going back. */
	let leaveTo: PieceId | undefined;

	let timer: ReturnType<typeof setTimeout> | undefined;
	let latest = 0;

	const piece = $derived(library.doc?.pieces[pieceId]);
	const index = $derived(library.index);
	const currentSetting = $derived(piece?.external?.thesession?.settingId);
	const choosingSetting = $derived(step.kind === 'settings');
	/** The footer: the preview speed while there's something to preview, and Skip/Cancel/Done. */
	const speed = $derived(step.kind === 'results' || (step.kind === 'settings' && !!step.tune));
	const done = $derived(step.kind === 'settings' && (!!step.tune || !!step.error));

	onDestroy(() => {
		clearTimeout(timer);
		preview.stop();
	});

	onMount(() => {
		dialog.showModal();
		if (settingsOf) {
			const { tuneId, name } = settingsOf;
			const hit: SearchHit = { id: tuneId, name, url: tuneUrl(tuneId), type: '', date: '' };
			void chooseSetting(hit, theSession.fetchTune(tuneId), true);
			heading?.focus();
			return;
		}
		input?.focus();
		input?.select();
		if (query) void search();
	});

	function close() {
		dialog.close();
	}

	function onDialogClose() {
		preview.stop();
		if (leaveTo) onleave(leaveTo);
		else onclose();
	}

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

	$effect(() => {
		// Tunes looked at before show their settings, keys and tunebooks (from the cache only).
		if (results) theSession.prime(results.map((r) => r.id));
	});

	function oninput() {
		clearTimeout(timer);
		timer = setTimeout(search, SEARCH_DELAY);
	}

	function pick(hit: SearchHit) {
		if (!piece) return;
		preview.stop();
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
		if (tune.settings.length === 0) return close();
		if (tune.settings.length === 1 && !always) {
			// Nothing to choose: fill whatever is still blank.
			useSetting(tune.settings[0], false);
			return;
		}
		step = { kind: 'settings', hit, tune };
		await tick();
		heading?.focus();
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
		close();
	}

	function backToResults() {
		preview.stop();
		step = { kind: 'results' };
		void tick().then(() => input?.focus());
	}

	function openExisting(target: Piece, wasBlank: boolean) {
		// A new piece that holds nothing but this search is just a stray duplicate.
		if (isNew && wasBlank) library.change((d) => softDelete(d, pieceId));
		leaveTo = target.id;
		close();
	}

	function mergeInto(target: Piece) {
		const name = target.title ?? 'the existing tune';
		library.change((d) => mergePieces(d, target.id, pieceId));
		leaveTo = target.id;
		close();
		ui.showToast(`Merged into “${name}”`);
	}

	/** A tune's first setting, fetched (or read from the cache) when its preview is asked for. */
	async function firstSetting(tuneId: number): Promise<SynthTarget> {
		const tune = await theSession.fetchTune(tuneId).catch((e) => {
			throw new Error(loadErrorMessage(e), { cause: e });
		});
		const setting = tune.settings[0];
		if (!setting) throw new Error('This tune has no settings to play.');
		return { tuneId, settingId: setting.id };
	}
</script>

{#snippet previewButton(key: string, label: string, target: () => Promise<SynthTarget>)}
	{@const state = preview.state(key)}
	<button
		type="button"
		class="btn-quiet play"
		aria-label={label}
		title={label}
		aria-pressed={state !== 'idle'}
		data-state={state}
		onclick={() => preview.toggle(key, target)}
	>
		{#if state === 'loading'}<span class="spinner" aria-hidden="true"
			></span>{:else if state === 'playing'}■{:else}▶{/if}
	</button>
{/snippet}

{#snippet previewError(key: string)}
	{#if preview.error?.key === key}
		<p class="error small row-error" role="alert">{preview.error.message}</p>
	{/if}
{/snippet}

<dialog bind:this={dialog} class="picker" onclose={onDialogClose} aria-labelledby="{uid}-heading">
	<div class="frame">
		<header>
			{#if choosingSetting && !settingsOf}
				<button
					type="button"
					class="icon-btn"
					aria-label="Back to search results"
					title="Back to search results"
					onclick={backToResults}>‹</button
				>
			{/if}
			<h2 id="{uid}-heading" tabindex="-1" bind:this={heading}>
				{choosingSetting ? 'Choose a setting' : 'Find a tune on thesession.org'}
			</h2>
			<button type="button" class="icon-btn" aria-label="Close" title="Close" onclick={close}
				>×</button
			>
		</header>

		{#if step.kind === 'results'}
			<form
				class="search-row"
				role="search"
				onsubmit={(e) => {
					e.preventDefault();
					void search();
				}}
			>
				<input
					bind:this={input}
					type="search"
					aria-label="Tune name"
					placeholder="Tune name"
					autocomplete="off"
					enterkeyhint="search"
					bind:value={query}
					{oninput}
					onkeydown={(e) => {
						// A search box clears itself on Escape; here Escape means "close", as elsewhere.
						if (e.key === 'Escape') {
							e.preventDefault();
							close();
						}
					}}
				/>
				<button type="submit" disabled={!query.trim()}>Search</button>
			</form>
		{/if}

		<div class="body">
			{#if step.kind === 'results'}
				<div aria-live="polite">
					{#if searchError}
						<p class="error">{searchError}</p>
					{:else if searching && !results}
						<p class="muted">Searching…</p>
					{:else if results && results.length === 0}
						<p class="muted">No tunes found on thesession.org.</p>
					{:else if !results}
						<p class="muted">Type a tune’s name, or one of its other names.</p>
					{/if}
				</div>
				{#if results && results.length > 0}
					<ul class="list" aria-label="thesession.org results">
						{#each results as hit (hit.id)}
							{@const inLibrary = (index?.withTune(hit.id) ?? []).some((p) => p.id !== pieceId)}
							{@const known = theSession.tunes.get(hit.id)}
							{@const meter = typeMeter(hit.type)}
							<li class="row">
								<button type="button" class="choose" onclick={() => pick(hit)}>
									<span class="line">
										<span class="name">{hit.name}</span>
										<span class="type">{typeTag(hit.type) ?? hit.type}</span>
										{#if meter}<span class="muted small">{meter}</span>{/if}
										{#if inLibrary}<span class="chip in-lib">In library</span>{/if}
									</span>
									{#if hit.alias}<span class="muted small">aka {hit.alias}</span>{/if}
									{#if known}
										{@const others = otherNames(hit.name, known.aliases, hit.alias)}
										<span class="muted small meta">{tuneSummary(known)}</span>
										{#if others.length > 0}
											<span class="muted small aliases"
												>Also {others.slice(0, 4).join(', ')}{others.length > 4 ? '…' : ''}</span
											>
										{/if}
									{/if}
								</button>
								{@render previewButton(`tune:${hit.id}`, `Preview ${hit.name}`, () =>
									firstSetting(hit.id)
								)}
								{@render previewError(`tune:${hit.id}`)}
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
					<button type="button" onclick={() => openExisting(target, wasBlank)}>Open existing</button
					>
					<button type="button" class="btn-quiet" onclick={() => mergeInto(target)}
						>Merge into existing</button
					>
					<button type="button" class="btn-quiet" onclick={() => chooseSetting(hit)}
						>Keep both</button
					>
				</div>
			{:else if step.kind === 'settings'}
				{#if step.error}
					<p class="error">
						Linked to “{step.hit.name}”, but couldn’t load its settings. {step.error}
					</p>
				{:else if !step.tune}
					<p class="muted" aria-live="polite">Loading settings…</p>
				{:else}
					{@const tune = step.tune}
					{@const meter = typeMeter(tune.type)}
					<p id="{uid}-settings">
						“{tune.name}” has {tune.settings.length}
						{tune.settings.length === 1 ? 'setting' : 'settings'}. Pick one for the key and first
						notes. ▶ plays it.
					</p>
					<ul class="list" aria-labelledby="{uid}-settings">
						{#each tune.settings as setting, i (setting.id)}
							{@const key = settingKeyLabel(setting.key)}
							{@const notes = firstBars(setting.abc, 2)}
							{@const by = postedBy(setting)}
							<li class="row" class:current={setting.id === currentSetting}>
								<button
									type="button"
									class="choose"
									aria-label="Setting {i + 1}, {key}: {notes}"
									aria-current={setting.id === currentSetting ? 'true' : undefined}
									onclick={() => useSetting(setting)}
								>
									<span class="line">
										<span class="name">Setting {i + 1}</span>
										<span class="type">{key}</span>
										{#if meter}<span class="muted small">{meter}</span>{/if}
										{#if setting.id === currentSetting}<span class="chip">Current</span>{/if}
									</span>
									{#if by}<span class="muted small">{by}</span>{/if}
									<Incipit abc={incipitAbc(setting, tune.type)} text={notes} />
								</button>
								{@render previewButton(`setting:${setting.id}`, `Preview setting ${i + 1}`, () =>
									Promise.resolve({ tuneId: tune.id, settingId: setting.id })
								)}
								{@render previewError(`setting:${setting.id}`)}
							</li>
						{/each}
					</ul>
				{/if}
			{/if}
		</div>

		{#if speed || done}
			<footer>
				{#if speed}
					<SpeedControl
						rate={preview.rate}
						onchange={(r) => preview.setRate(r)}
						label="Preview speed"
					/>
				{/if}
				{#if done}
					<button type="button" class="btn-quiet end" onclick={close}
						>{step.kind === 'settings' && step.error
							? 'Done'
							: settingsOf
								? 'Cancel'
								: 'Skip'}</button
					>
				{/if}
			</footer>
		{/if}
	</div>
</dialog>

<style>
	dialog {
		width: 100%;
		max-width: 100%;
		height: 100dvh;
		max-height: 100dvh;
		margin: 0;
		padding: 0;
		border: none;
		background: var(--color-bg);
		color: var(--color-text);
	}

	/* The dialog underneath is hidden while this is open, its backdrop too. */
	dialog::backdrop {
		background: rgb(0 0 0 / 0.4);
	}

	.frame {
		display: flex;
		flex-direction: column;
		height: 100%;
	}

	header {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		padding: var(--space-1) var(--space-2) var(--space-1) var(--space-3);
		border-bottom: 1px solid var(--color-border);
	}

	header .icon-btn:first-child {
		margin-left: calc(-1 * var(--space-2));
	}

	h2 {
		flex: 1;
		min-width: 0;
		margin: 0;
		font-size: 1.125rem;
	}

	h2:focus {
		outline: none;
	}

	.search-row {
		display: flex;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border-bottom: 1px solid var(--color-border);
	}

	.search-row input {
		flex: 1;
		min-width: 0;
	}

	.body {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		display: grid;
		align-content: start;
		gap: var(--space-2);
		padding: var(--space-3);
	}

	footer {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		padding-bottom: calc(var(--space-2) + env(safe-area-inset-bottom));
		border-top: 1px solid var(--color-border);
	}

	.end {
		margin-left: auto;
	}

	p {
		margin: 0;
	}

	.list {
		display: grid;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: start;
		gap: var(--space-2);
		padding: var(--space-2);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
	}

	.row.current {
		border-color: var(--color-accent);
	}

	.choose {
		display: grid;
		gap: 2px;
		justify-items: start;
		min-width: 0;
		padding: var(--space-1);
		text-align: left;
		background: transparent;
		color: var(--color-text);
		font-weight: normal;
	}

	@media (hover: hover) {
		.choose:hover .name {
			text-decoration: underline;
		}
	}

	.line {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0 var(--space-2);
		width: 100%;
	}

	.name {
		font-weight: 600;
	}

	.type {
		color: var(--color-accent);
		font-size: 0.875rem;
	}

	.in-lib {
		margin-left: auto;
	}

	.meta,
	.aliases {
		overflow-wrap: anywhere;
	}

	.play {
		min-width: var(--touch);
		padding: 0;
		font-size: 1.125rem;
	}

	.play[aria-pressed='true'] {
		background: var(--color-accent);
		color: var(--color-on-accent);
		border-color: var(--color-accent);
	}

	.spinner {
		display: inline-block;
		width: 1rem;
		height: 1rem;
		border: 2px solid currentColor;
		border-right-color: transparent;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.spinner {
			animation: none;
		}
	}

	.row-error {
		grid-column: 1 / -1;
	}

	.buttons {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.small {
		font-size: 0.875rem;
	}

	.error {
		color: var(--color-danger);
	}

	@media (min-width: 40rem) {
		dialog {
			width: min(40rem, calc(100% - 2 * var(--space-4)));
			height: min(48rem, calc(100dvh - 2 * var(--space-4)));
			margin: auto;
			border: 1px solid var(--color-border);
			border-radius: var(--radius);
			box-shadow: var(--shadow);
		}

		header,
		.search-row,
		.body,
		footer {
			padding-left: var(--space-4);
			padding-right: var(--space-4);
		}

		header {
			padding-right: var(--space-2);
		}
	}
</style>
