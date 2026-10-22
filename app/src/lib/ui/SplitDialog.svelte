<!--
	Split (PLAN.md §6.4): choose one of the piece's recordings, select a region in the trim editor,
	optionally name it, and it becomes a new child (Part of a Tune, Tune of a Set, …) with a clip on
	the same Source. "Split another" keeps going, each next region starting where the last ended.
	Without a recording (or with "No recording") it adds a blank child.
-->
<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { formatTime } from '#lib/audio/bounds.ts';
	import { player } from '#lib/audio/player.svelte.ts';
	import { KIND_LABEL } from '#lib/domain/format.ts';
	import { isPlayable, playbackOf, recordingTitle } from '#lib/domain/providers.ts';
	import { CHILD_KIND, splitPiece } from '#lib/domain/relations.ts';
	import type { ClipId, Piece } from '#lib/domain/types.ts';
	import { audioFiles } from '#lib/store/audio.svelte.ts';
	import { library } from '#lib/store/library.svelte.ts';
	import { oembed } from '#lib/store/oembed.svelte.ts';
	import TrimEditor, { type TrimRange } from './TrimEditor.svelte';
	import { ui } from './state.svelte.ts';

	let { piece, onclose }: { piece: Piece; onclose: () => void } = $props();

	const uid = $props.id();
	let dialog: HTMLDialogElement;

	const kind = $derived(CHILD_KIND[piece.kind]);
	const kindLabel = $derived(KIND_LABEL[kind]);
	const clips = $derived(
		(library.index?.clipsOf(piece) ?? []).filter(({ source }) => isPlayable(source))
	);

	// svelte-ignore state_referenced_locally
	let clipId = $state<ClipId | ''>(clips[0]?.clip.id ?? '');
	let title = $state('');
	let blob = $state.raw<Blob>();
	let ready = $state(false);
	let error = $state('');
	/** Bumped for each new region, so the editor starts afresh. */
	let round = $state(0);
	/** Where the next region starts: the end of the last split, else the clip's own start. */
	let nextStart = $state<number>();
	/** The last split, shown with "Split another" / "Done". */
	let last = $state<{ name: string; start: number; end: number }>();

	const current = $derived(clips.find((c) => c.clip.id === clipId));
	const playback = $derived(current ? playbackOf(current.source) : undefined);

	onMount(() => dialog.showModal());

	// Load the chosen recording: the bytes for the waveform, or the YouTube player for the slider.
	// Only when the choice changes, not on every doc change (each split is one).
	$effect(() => {
		const id = clipId;
		const c = untrack(() => clips.find((x) => x.clip.id === id));
		ready = false;
		error = '';
		blob = undefined;
		if (!c) return;
		let stale = false;
		(async () => {
			try {
				if (playbackOf(c.source) === 'youtube') {
					await player.open(piece.id, c.clip.id, { autoplay: false });
					if (player.error) throw new Error(player.error);
				} else {
					if (player.playing) player.pause();
					const b = await audioFiles.blobFor(c.source);
					if (!stale) blob = b;
				}
				if (!stale) ready = true;
			} catch (e) {
				if (!stale) error = e instanceof Error ? e.message : String(e);
			}
		})();
		return () => (stale = true);
	});

	function chooseClip(id: ClipId | '') {
		clipId = id;
		nextStart = undefined;
		last = undefined;
		round++;
	}

	function split({ start, end }: TrimRange, duration: number) {
		const whole = duration > 0 && end >= duration - 0.05;
		const name = title.trim();
		try {
			library.change((d) =>
				splitPiece(d, piece.id, {
					clipId: current?.clip.id,
					start: start > 0.05 ? start : null,
					end: whole ? null : end,
					title: name || undefined
				})
			);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
			return;
		}
		ui.now = Date.now();
		last = { name: name || `Untitled ${kindLabel.toLowerCase()}`, start, end };
		nextStart = end;
		title = '';
	}

	function blank() {
		const name = title.trim();
		library.change((d) => splitPiece(d, piece.id, { title: name || undefined }));
		ui.showToast(`Added ${name ? `“${name}”` : `an untitled ${kindLabel.toLowerCase()}`}`);
		dialog.close();
	}

	function another() {
		last = undefined;
		round++;
	}

	function close() {
		player.endPreview();
		onclose();
	}
</script>

<dialog bind:this={dialog} onclose={close} aria-labelledby="{uid}-heading">
	<div class="sheet">
		<h2 id="{uid}-heading">Split {kindLabel}</h2>

		{#if clips.length > 0}
			<div class="field">
				<label for="{uid}-clip">Recording</label>
				<select
					id="{uid}-clip"
					value={clipId}
					onchange={(e) => chooseClip(e.currentTarget.value as ClipId | '')}
				>
					{#each clips as c (c.clip.id)}
						<option value={c.clip.id}
							>{recordingTitle(c.clip, c.source, oembed.lookup(c.source)?.title)}</option
						>
					{/each}
					<option value="">No recording (blank {kindLabel.toLowerCase()})</option>
				</select>
			</div>
		{:else}
			<p class="muted small">
				There’s no recording to split from, so this adds a blank {kindLabel.toLowerCase()}.
			</p>
		{/if}

		{#if last}
			<div class="done">
				<p role="status">
					Split off “{last.name}” ({formatTime(last.start)}–{formatTime(last.end)}).
				</p>
				<div class="buttons">
					<button type="button" onclick={another}>Split another</button>
					<button type="button" class="btn-quiet" onclick={() => dialog.close()}>Done</button>
				</div>
			</div>
		{:else}
			<div class="field">
				<label for="{uid}-title"
					>Name of the new {kindLabel.toLowerCase()} <span class="muted">(optional)</span></label
				>
				<input id="{uid}-title" type="text" autocomplete="off" bind:value={title} />
			</div>

			{#if !current}
				<div class="buttons">
					<button type="button" onclick={blank}>Add blank {kindLabel}</button>
					<button type="button" class="btn-quiet" onclick={() => dialog.close()}>Cancel</button>
				</div>
			{:else if error}
				<p class="error" role="alert">{error}</p>
				<button type="button" class="btn-quiet" onclick={() => dialog.close()}>Close</button>
			{:else if !ready}
				<p class="muted">Loading…</p>
			{:else}
				<p class="muted small">
					Select the region for the new {kindLabel.toLowerCase()}. The recording itself isn’t copied
					or changed.
				</p>
				{#key `${clipId}:${round}`}
					{#if playback === 'youtube'}
						<TrimEditor
							duration={player.duration}
							start={nextStart ?? current.clip.start}
							end={nextStart === undefined ? current.clip.end : undefined}
							currentTime={player.time}
							onpreview={({ start, end }) => player.preview(start, end)}
							onstoppreview={() => {
								player.pause();
								player.endPreview();
							}}
							onsave={split}
							oncancel={() => dialog.close()}
							saveLabel="Split off {kindLabel}"
						/>
					{:else}
						<TrimEditor
							{blob}
							start={nextStart ?? current.clip.start}
							end={nextStart === undefined ? current.clip.end : undefined}
							onsave={split}
							oncancel={() => dialog.close()}
							saveLabel="Split off {kindLabel}"
						/>
					{/if}
				{/key}
			{/if}
		{/if}
	</div>
</dialog>

<style>
	dialog {
		width: min(44rem, calc(100% - 2 * var(--space-3)));
		max-height: calc(100dvh - 2 * var(--space-3));
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
	}

	p {
		margin: 0;
	}

	.field {
		display: grid;
		gap: var(--space-1);
	}

	.field label {
		font-weight: 600;
	}

	.small {
		font-size: 0.875rem;
	}

	.error {
		color: var(--color-danger);
	}

	.buttons {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.done {
		display: grid;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--color-accent);
		border-radius: var(--radius);
		background: var(--color-accent-soft);
	}
</style>
