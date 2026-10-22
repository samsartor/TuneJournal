<!--
	Edit a recording's own details (PLAN.md §5): its title, and the key and first notes as played in
	it, which override the piece's. Fields save when they change, like the edit modal.
-->
<script lang="ts">
	import { hasKey } from '#lib/domain/derived.ts';
	import { formatKey } from '#lib/domain/key.ts';
	import { recordingTitle } from '#lib/domain/providers.ts';
	import { updateClip, type ClipPatch } from '#lib/domain/recordings.ts';
	import type { ClipId, PieceId } from '#lib/domain/types.ts';
	import { library } from '#lib/store/library.svelte.ts';
	import KeyInput from './KeyInput.svelte';

	let {
		pieceId,
		clipId,
		lookedUpTitle,
		onclose
	}: { pieceId: PieceId; clipId: ClipId; lookedUpTitle?: string; onclose: () => void } = $props();

	let dialog: HTMLDialogElement;
	const piece = $derived(library.doc?.pieces[pieceId]);
	const clip = $derived(piece?.clips[clipId]);
	const source = $derived(clip ? library.doc?.sources[clip.sourceId] : undefined);
	const pieceKey = $derived(piece && library.index ? library.index.effectiveKey(piece) : undefined);

	// svelte-ignore state_referenced_locally
	let title = $state(clip?.title ?? '');
	// svelte-ignore state_referenced_locally
	let firstNotes = $state(clip?.firstNotes ?? '');

	$effect(() => {
		dialog.showModal();
	});

	function save(patch: ClipPatch) {
		if (clip) library.change((d) => updateClip(d, pieceId, clipId, patch));
	}

	// The key input reports every keystroke; save it after a pause, like the edit modal.
	let keyTimer: ReturnType<typeof setTimeout> | undefined;
	let pendingKey: { key: string | null } | undefined;

	function queueKey(key: string | null) {
		pendingKey = { key };
		clearTimeout(keyTimer);
		keyTimer = setTimeout(flushKey, 400);
	}

	function flushKey() {
		clearTimeout(keyTimer);
		if (pendingKey) save(pendingKey);
		pendingKey = undefined;
	}

	function close() {
		flushKey();
		if (title !== (clip?.title ?? '')) save({ title });
		if (firstNotes !== (clip?.firstNotes ?? '')) save({ firstNotes });
		onclose();
	}
</script>

<dialog bind:this={dialog} onclose={close} aria-labelledby="clip-heading">
	{#if piece && clip && source}
		<div class="sheet">
			<header>
				<h2 id="clip-heading">Recording details</h2>
				<button type="button" onclick={() => dialog.close()}>Done</button>
			</header>
			<div class="field">
				<label for="clip-title">Title</label>
				<input
					id="clip-title"
					type="text"
					autocomplete="off"
					placeholder={recordingTitle({}, source, lookedUpTitle)}
					bind:value={title}
					onchange={() => save({ title })}
				/>
			</div>
			{#if hasKey(piece)}
				<p class="muted small">
					Key and first notes as played in this recording, if they differ from the tune’s ({pieceKey
						? formatKey(pieceKey)
						: 'no key'}{piece.firstNotes ? `, ${piece.firstNotes}` : ''}).
				</p>
				<KeyInput id="clip-key" value={clip.key} onchange={queueKey} />
				<div class="field">
					<label for="clip-notes">First notes (ABC)</label>
					<input
						id="clip-notes"
						class="abc"
						type="text"
						autocomplete="off"
						spellcheck="false"
						placeholder={piece.firstNotes ?? ''}
						bind:value={firstNotes}
						onchange={() => save({ firstNotes })}
					/>
				</div>
			{/if}
		</div>
	{/if}
</dialog>

<style>
	dialog {
		width: min(32rem, calc(100% - 2 * var(--space-3)));
		padding: 0;
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-bg);
		color: var(--color-text);
		box-shadow: var(--shadow);
	}

	dialog::backdrop {
		background: rgb(0 0 0 / 0.4);
	}

	.sheet {
		display: grid;
		gap: var(--space-3);
		padding: var(--space-3);
	}

	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}

	h2 {
		margin: 0;
		font-size: 1.25rem;
	}

	.field {
		display: grid;
		gap: var(--space-1);
	}

	label {
		font-weight: 600;
	}

	.abc {
		font-family: var(--font-mono);
	}

	.small {
		margin: 0;
		font-size: 0.875rem;
	}
</style>
