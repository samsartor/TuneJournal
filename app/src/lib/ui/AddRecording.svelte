<!--
	The import panel (PLAN.md §6.2): Upload, Google Drive (when configured), and paste a link
	(YouTube, Spotify or anything else). Prominent when a piece has nothing to play yet.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { PROVIDERS } from '#lib/domain/providers.ts';
	import type { ClipId, PieceId } from '#lib/domain/types.ts';
	import { detectLink, type DetectedLink } from '#lib/integrations/links.ts';
	import type { OEmbed } from '#lib/integrations/oembed.ts';
	import { gdrive } from '#lib/store/gdrive.svelte.ts';
	import { oembed } from '#lib/store/oembed.svelte.ts';
	import ProviderIcon from './ProviderIcon.svelte';
	import { addFromDrive, addLink, addUpload } from './recordings.ts';
	import { ui } from './state.svelte.ts';

	let {
		pieceId,
		prominent = false,
		onadded,
		oncancel
	}: {
		pieceId: PieceId;
		prominent?: boolean;
		onadded?: (clipId: ClipId) => void;
		oncancel?: () => void;
	} = $props();

	const uid = $props.id();
	let busy = $state(false);
	let text = $state('');
	let link = $state.raw<DetectedLink>();
	let preview = $state.raw<OEmbed>();
	let previewing = $state(false);
	let error = $state('');
	let android = $state(false);
	let timer: ReturnType<typeof setTimeout> | undefined;
	let fileInput: HTMLInputElement;

	onMount(() => {
		android = /Android/i.test(navigator.userAgent);
		return () => clearTimeout(timer);
	});

	async function run(fn: () => Promise<ClipId | undefined>) {
		busy = true;
		try {
			const id = await fn();
			if (id) onadded?.(id);
		} catch (e) {
			ui.showToast(`Couldn’t add the recording: ${e instanceof Error ? e.message : e}`);
		} finally {
			busy = false;
		}
	}

	function upload(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		void run(async () => {
			const id = await addUpload(pieceId, file);
			input.value = '';
			return id;
		});
	}

	function onInput() {
		error = '';
		clearTimeout(timer);
		link = text.trim() ? detectLink(text) : undefined;
		preview = undefined;
		const found = link;
		if (!found || !oembed.has(found.provider)) return;
		previewing = true;
		timer = setTimeout(async () => {
			try {
				const data = await oembed.fetch(found.provider, found.externalId ?? found.url, found.url);
				if (link === found) preview = data;
			} catch {
				// No preview; the link can still be added.
			} finally {
				if (link === found) previewing = false;
			}
		}, 300);
	}

	function addPasted(e: SubmitEvent) {
		e.preventDefault();
		if (!link) {
			error = text.trim() ? 'That doesn’t look like a link.' : 'Paste a link first.';
			return;
		}
		const found = link;
		void run(async () => {
			const id = addLink(pieceId, found);
			text = '';
			link = undefined;
			preview = undefined;
			return id;
		});
	}
</script>

<div class="import" class:prominent role="group" aria-label="Add a recording">
	{#if prominent}
		<p class="lead">Add a recording to listen, loop and slow down.</p>
	{/if}

	<div class="sources">
		<button type="button" class="source" disabled={busy} onclick={() => fileInput.click()}>
			<ProviderIcon provider="upload" label={false} /> Upload a file
		</button>
		<input
			bind:this={fileInput}
			class="visually-hidden"
			type="file"
			accept="audio/*,.m4a,.mp3,.wav,.ogg,.opus,.aac,.flac,.webm"
			aria-label="Upload a file"
			tabindex="-1"
			onchange={upload}
		/>
		{#if gdrive.configured}
			<button
				type="button"
				class="source"
				disabled={busy}
				onclick={() => run(() => addFromDrive(pieceId))}
			>
				<ProviderIcon provider="gdrive" label={false} /> Google Drive
			</button>
		{/if}
	</div>

	<form class="paste" novalidate onsubmit={addPasted}>
		<label for="{uid}-link">YouTube, Spotify or other link</label>
		<div class="paste-row">
			<input
				id="{uid}-link"
				type="url"
				inputmode="url"
				autocomplete="off"
				placeholder="https://…"
				bind:value={text}
				oninput={onInput}
				aria-describedby="{uid}-link-status"
			/>
			<button type="submit" disabled={busy || !text.trim()}>Add link</button>
		</div>
		<div id="{uid}-link-status" class="link-status" aria-live="polite">
			{#if error}
				<p class="error">{error}</p>
			{:else if link}
				<div class="preview" data-testid="link-preview">
					{#if preview?.thumbnailUrl}
						<img src={preview.thumbnailUrl} alt="" width="64" height="48" loading="lazy" />
					{:else}
						<ProviderIcon provider={link.provider} label={false} />
					{/if}
					<span>
						<strong>{PROVIDERS[link.provider].label}</strong>
						{#if preview?.title}· {preview.title}{:else if previewing}· looking up…{/if}
						{#if link.start}<span class="muted">· from {Math.round(link.start)} s</span>{/if}
					</span>
				</div>
			{/if}
		</div>
	</form>

	{#if android}
		<p class="hint muted">
			From Pixel Recorder: open a recording, tap <b>Share → Audio</b> and choose TuneJournal (the installed
			app).
		</p>
	{/if}

	{#if oncancel}
		<button type="button" class="btn-quiet cancel" onclick={oncancel}>Cancel</button>
	{/if}
</div>

<style>
	.import {
		display: grid;
		gap: var(--space-3);
		padding: var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-surface);
	}

	.import.prominent {
		border: 2px dashed color-mix(in srgb, var(--color-accent) 50%, var(--color-border));
		background: var(--color-accent-soft);
	}

	.lead {
		margin: 0;
		font-weight: 600;
	}

	.sources {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.source {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		background: var(--color-surface);
		color: var(--color-text);
		border: 1px solid var(--color-border);
		font-weight: 600;
	}

	.paste {
		display: grid;
		gap: var(--space-1);
	}

	.paste label {
		font-size: 0.875rem;
		font-weight: 600;
	}

	.paste-row {
		display: flex;
		gap: var(--space-2);
	}

	.paste-row input {
		flex: 1;
		min-width: 0;
	}

	.link-status:empty {
		display: none;
	}

	.preview {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: 0.9375rem;
	}

	.preview img {
		border-radius: calc(var(--radius) * 0.5);
		object-fit: cover;
	}

	.error {
		margin: 0;
		color: var(--color-danger);
	}

	.hint {
		margin: 0;
		font-size: 0.875rem;
	}

	.cancel {
		justify-self: start;
	}
</style>
