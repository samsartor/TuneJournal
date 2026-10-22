<!--
	"Shared recording" (PLAN.md §7): where the Web Share Target lands. Shared audio files wait in
	the inbox (bytes already in the audio cache) until attached to an existing piece or a new Tune;
	shared links go through the same flow as pasting one.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { audioCache, type InboxItem } from '#lib/audio/cache.ts';
	import { createPiece } from '#lib/domain/ops.ts';
	import { PROVIDERS } from '#lib/domain/providers.ts';
	import type { Piece, PieceId } from '#lib/domain/types.ts';
	import { titleFromFileName } from '#lib/integrations/share-target.ts';
	import { library } from '#lib/store/library.svelte.ts';
	import PiecePicker from '#lib/ui/PiecePicker.svelte';
	import ProviderIcon from '#lib/ui/ProviderIcon.svelte';
	import { attachShared, sharedLink } from '#lib/ui/recordings.ts';
	import { ui } from '#lib/ui/state.svelte.ts';

	let items = $state.raw<InboxItem[]>([]);
	let loaded = $state(false);
	let urls = $state<Record<string, string>>({});
	let titles = $state<Record<string, string>>({});
	let params = $state<Record<string, string>>({});
	let busy = $state(false);

	async function refresh() {
		try {
			items = await audioCache.inbox();
		} catch (e) {
			console.warn('Couldn’t read shared items', e);
		}
		for (const item of items) {
			titles[item.id] ??=
				item.kind === 'file'
					? (item.title ?? titleFromFileName(item.name ?? ''))
					: (item.title ?? '');
			if (item.kind === 'file' && !urls[item.id]) {
				const blob = await audioCache.get(item.id);
				if (blob) urls[item.id] = URL.createObjectURL(blob);
			}
		}
		loaded = true;
	}

	onMount(() => {
		params = Object.fromEntries(new URLSearchParams(location.search));
		void refresh();
		return () => Object.values(urls).forEach((u) => URL.revokeObjectURL(u));
	});

	async function attach(item: InboxItem, pieceId: PieceId) {
		busy = true;
		try {
			await attachShared(item, pieceId, titles[item.id]);
			const piece = library.doc?.pieces[pieceId];
			ui.showToast(`Added to ${piece?.title ? `“${piece.title}”` : 'the new tune'}`);
			await goto(resolve('/(main)/piece/[id]', { id: pieceId }));
		} catch (e) {
			ui.showToast(`Couldn’t add it: ${e instanceof Error ? e.message : e}`);
			busy = false;
		}
	}

	function toExisting(item: InboxItem, piece: Piece) {
		void attach(item, piece.id);
	}

	async function toNewTune(item: InboxItem) {
		const id = library.change((d) => createPiece(d));
		await attach(item, id);
		ui.openEdit(id, true);
	}

	async function discard(item: InboxItem) {
		await audioCache.removeFromInbox(item.id, { discard: item.kind === 'file' });
		if (urls[item.id]) URL.revokeObjectURL(urls[item.id]);
		await refresh();
	}

	function size(bytes = 0) {
		return bytes > 1024 * 1024
			? `${(bytes / 1024 / 1024).toFixed(1)} MB`
			: `${Math.ceil(bytes / 1024)} KB`;
	}
</script>

<main>
	<a class="back" href={resolve('/(main)')}>← All pieces</a>
	<h1>Shared recording</h1>

	{#if params.error}
		<p class="error" role="alert">Something went wrong receiving the share: {params.error}</p>
	{/if}

	{#if !loaded || library.status !== 'ready'}
		<p class="muted">Loading…</p>
	{:else if items.length === 0}
		<p class="muted">
			Nothing waiting. Share a recording to TuneJournal from another app and it lands here.
		</p>
	{:else}
		<ul class="items">
			{#each items as item (item.id)}
				{@const link = item.kind === 'text' ? sharedLink(item) : undefined}
				<li
					class="item"
					aria-label={item.kind === 'file' ? item.name : (item.title ?? 'Shared link')}
				>
					{#if item.kind === 'file'}
						<p class="what">
							<ProviderIcon provider="upload" />
							<span
								><strong>{item.name}</strong>
								<span class="muted">{item.mime} · {size(item.size)}</span></span
							>
						</p>
						{#if urls[item.id]}
							<audio controls src={urls[item.id]} preload="metadata"></audio>
						{/if}
						<div class="field">
							<label for="title-{item.id}">Recording title</label>
							<input
								id="title-{item.id}"
								type="text"
								autocomplete="off"
								bind:value={titles[item.id]}
							/>
						</div>
					{:else if link}
						<p class="what">
							<ProviderIcon provider={link.provider} />
							<span
								><strong>{PROVIDERS[link.provider].label}</strong>
								<span class="url">{link.url}</span></span
							>
						</p>
						{#if item.title || item.text}<p class="muted shared-text">
								{item.title ?? ''}
								{item.text ?? ''}
							</p>{/if}
					{:else}
						<p class="what">Shared text, with no link or file:</p>
						<p class="shared-text">{item.title ?? ''} {item.text ?? ''}</p>
					{/if}

					{#if item.kind === 'file' || link}
						<PiecePicker
							label="Add to a piece"
							actionLabel="Add to"
							onpick={(piece) => toExisting(item, piece)}
						/>
						<div class="actions">
							<button type="button" disabled={busy} onclick={() => toNewTune(item)}>New tune</button
							>
							<button type="button" class="btn-quiet" disabled={busy} onclick={() => discard(item)}
								>Discard</button
							>
						</div>
					{:else}
						<div class="actions">
							<button type="button" class="btn-quiet" onclick={() => discard(item)}>Discard</button>
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</main>

<style>
	main {
		display: grid;
		gap: var(--space-3);
		max-width: 40rem;
		margin: 0 auto;
		padding: var(--space-3);
		padding-bottom: calc(var(--space-4) * 2 + env(safe-area-inset-bottom));
	}

	.back {
		display: inline-flex;
		align-items: center;
		min-height: var(--touch);
		text-decoration: none;
		font-weight: 600;
	}

	h1 {
		margin: 0;
	}

	p {
		margin: 0;
	}

	.items {
		display: grid;
		gap: var(--space-3);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.item {
		display: grid;
		gap: var(--space-3);
		padding: var(--space-3);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
	}

	.what {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		overflow-wrap: anywhere;
	}

	.url {
		font-size: 0.875rem;
		color: var(--color-muted);
	}

	audio {
		width: 100%;
	}

	.field {
		display: grid;
		gap: var(--space-1);
	}

	.field label {
		font-weight: 600;
	}

	.shared-text {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.error {
		color: var(--color-danger);
	}
</style>
