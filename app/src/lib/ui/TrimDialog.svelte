<!--
	Trims one clip, with the trim editor's own transport (the clip plays through the global player,
	whose bar is behind this dialog): a waveform for file sources, a timeline for YouTube. Saving
	sets the clip's start/end; the source is never changed. A trim covering the whole recording is
	stored as no trim.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { player } from '#lib/audio/player.svelte.ts';
	import { updateClip } from '#lib/domain/recordings.ts';
	import { synthTarget } from '#lib/domain/synth.ts';
	import type { ClipId, PieceId } from '#lib/domain/types.ts';
	import { audioFiles } from '#lib/store/audio.svelte.ts';
	import { library } from '#lib/store/library.svelte.ts';
	import { synth } from '#lib/store/synth.svelte.ts';
	import TrimEditor, { type TrimRange } from './TrimEditor.svelte';
	import { ui } from './state.svelte.ts';

	let {
		pieceId,
		clipId,
		title,
		onclose
	}: { pieceId: PieceId; clipId: ClipId; title: string; onclose: () => void } = $props();

	let dialog: HTMLDialogElement;
	const clip = $derived(library.doc?.pieces[pieceId]?.clips[clipId]);
	const source = $derived(clip ? library.doc?.sources[clip.sourceId] : undefined);
	// svelte-ignore state_referenced_locally
	const piece = library.doc?.pieces[pieceId];
	// svelte-ignore state_referenced_locally
	const kind = piece && source ? synth.playback(piece, source) : undefined;

	let blob = $state.raw<Blob>();
	let error = $state('');
	let ready = $state(false);

	onMount(async () => {
		dialog.showModal();
		if (!source || !clip) return;
		try {
			// The editor's transport plays through the global player, paused until asked.
			await player.open(pieceId, clipId, { autoplay: false });
			if (player.error) throw new Error(player.error);
			const target = kind === 'synth' && piece && source ? synthTarget(piece, source) : undefined;
			if (target) {
				// The 100% rendering: its seconds are tune time, which the trim is kept in.
				blob = await synth.render(target, 1).catch((e) => {
					console.warn('No waveform', e);
					return undefined;
				});
			} else if (kind === 'file') {
				// Only for drawing the waveform; the editor still works without it.
				blob = await audioFiles.blobFor(source).catch((e) => {
					console.warn('No waveform', e);
					return undefined;
				});
			}
			ready = true;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	});

	function save({ start, end }: TrimRange, duration: number) {
		const whole = duration > 0 && end >= duration - 0.05;
		try {
			library.change((d) =>
				updateClip(d, pieceId, clipId, {
					start: start > 0.05 ? start : null,
					end: whole ? null : end
				})
			);
			ui.showToast('Trim saved');
			dialog.close();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	}

	function close() {
		if (player.isCurrent(pieceId, clipId) && player.playing) player.pause();
		player.endPreview();
		onclose();
	}
</script>

<dialog bind:this={dialog} onclose={close} aria-labelledby="trim-heading">
	<div class="sheet">
		<header>
			<h2 id="trim-heading">Trim “{title}”</h2>
		</header>
		<p class="muted small">
			Only this recording’s start and end change. The file itself isn’t touched.
		</p>
		{#if error}
			<p class="error" role="alert">{error}</p>
			<button type="button" class="btn-quiet" onclick={() => dialog.close()}>Close</button>
		{:else if !ready || !clip}
			<p class="muted">Loading…</p>
		{:else}
			<TrimEditor
				waveform={blob}
				duration={source?.durationSec}
				start={clip.start}
				end={clip.end}
				onsave={save}
				oncancel={() => dialog.close()}
			/>
		{/if}
	</div>
</dialog>

<style>
	dialog {
		width: min(44rem, calc(100% - 2 * var(--space-3)));
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

	h2 {
		margin: 0;
		font-size: 1.25rem;
		overflow-wrap: anywhere;
	}

	p {
		margin: 0;
	}

	.small {
		font-size: 0.875rem;
	}

	.error {
		color: var(--color-danger);
	}
</style>
