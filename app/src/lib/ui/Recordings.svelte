<!--
	The detail view's recordings section (PLAN.md §6.2, §6.7): clips in order, each with its
	provider decoration, play (or ↗ for links that open elsewhere), drag or menu to reorder, remove
	with undo, edit, trim, open the link (or save a local-only file) and "Keep offline". The import panel is prominent until something
	playable is attached, then folds into "+ Add recording".
-->
<script lang="ts">
	import { formatTime, trimLabel } from '#lib/audio/bounds.ts';
	import { player } from '#lib/audio/player.svelte.ts';
	import { formatKey } from '#lib/domain/key.ts';
	import {
		PROVIDERS,
		openLinkOf,
		isCacheable,
		isLocalOnly,
		isPlayable,
		recordingTitle
	} from '#lib/domain/providers.ts';
	import { moveClip, moveClipBy } from '#lib/domain/recordings.ts';
	import type { ClipId, Piece } from '#lib/domain/types.ts';
	import { audioFiles } from '#lib/store/audio.svelte.ts';
	import { gdrive } from '#lib/store/gdrive.svelte.ts';
	import { library } from '#lib/store/library.svelte.ts';
	import { oembed } from '#lib/store/oembed.svelte.ts';
	import { synth } from '#lib/store/synth.svelte.ts';
	import AddRecording from './AddRecording.svelte';
	import ClipDialog from './ClipDialog.svelte';
	import Menu from './Menu.svelte';
	import ProviderIcon from './ProviderIcon.svelte';
	import TrimDialog from './TrimDialog.svelte';
	import { backUp, downloadRecording, removeRecording } from './recordings.ts';
	import { ui } from './state.svelte.ts';

	let { piece }: { piece: Piece } = $props();

	const clips = $derived(library.index?.clipsOf(piece) ?? []);
	const hasPlayable = $derived(clips.some(({ source }) => isPlayable(source)));
	let adding = $state(false);
	let editing = $state<ClipId>();
	let trimming = $state<ClipId>();

	function titleOf(clip: (typeof clips)[number]) {
		return recordingTitle(clip.clip, clip.source, oembed.lookup(clip.source)?.title);
	}

	async function toggleKeep(c: (typeof clips)[number]) {
		const keep = !audioFiles.kept(c.source.id);
		try {
			await audioFiles.setKeep(c.source, keep);
			ui.showToast(keep ? 'Kept offline on this device' : 'No longer kept offline');
		} catch (e) {
			ui.showToast(`Couldn’t download it: ${e instanceof Error ? e.message : e}`);
		}
	}

	// Drag to reorder (pointer events on the handle; the menu has Move up/down for keyboards).
	let list = $state<HTMLElement>();
	let drag = $state<{ id: ClipId; from: number; over: number; dy: number; height: number }>();
	let startY = 0;
	let centers: number[] = [];

	function dragStart(e: PointerEvent, id: ClipId, index: number) {
		if (e.button !== 0) return;
		const rows = [...(list?.children ?? [])] as HTMLElement[];
		centers = rows.map((r) => {
			const rect = r.getBoundingClientRect();
			return rect.top + rect.height / 2;
		});
		startY = e.clientY;
		drag = { id, from: index, over: index, dy: 0, height: rows[index]?.offsetHeight ?? 0 };
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		e.preventDefault();
	}

	function dragMove(e: PointerEvent) {
		if (!drag) return;
		const dy = e.clientY - startY;
		const center = centers[drag.from] + dy;
		let over = 0;
		centers.forEach((c, i) => {
			if (i !== drag!.from && c < center) over++;
		});
		drag = { ...drag, dy, over };
	}

	function dragEnd() {
		if (!drag) return;
		const { id, from, over } = drag;
		drag = undefined;
		if (over !== from) library.change((d) => moveClip(d, piece.id, id, over));
	}

	function shift(index: number): number {
		if (!drag || index === drag.from) return 0;
		if (drag.from < drag.over && index > drag.from && index <= drag.over) return -drag.height;
		if (drag.from > drag.over && index < drag.from && index >= drag.over) return drag.height;
		return 0;
	}
</script>

<section class="recordings" aria-labelledby="recordings-heading">
	<h2 id="recordings-heading">Recordings</h2>

	{#if clips.length > 0}
		<ol class="clips" bind:this={list} aria-label="Recordings">
			{#each clips as c, i (c.clip.id)}
				{@const title = titleOf(c)}
				{@const info = PROVIDERS[c.source.provider]}
				{@const kind = synth.playback(piece, c.source)}
				{@const playable = kind !== 'link'}
				{@const current = player.isCurrent(piece.id, c.clip.id)}
				{@const trim = trimLabel(c.clip, c.source.durationSec)}
				{@const key = library.index?.clipKey(piece, c.clip)}
				{@const localOnly = isLocalOnly(c.source)}
				{@const cached = audioFiles.cached(c.source.id)}
				<li
					class="clip"
					class:current
					class:dragging={drag?.id === c.clip.id}
					style:--accent="var(--provider-{c.source.provider})"
					style:transform={drag?.id === c.clip.id
						? `translateY(${drag.dy}px)`
						: shift(i)
							? `translateY(${shift(i)}px)`
							: undefined}
					aria-label={title}
					data-testid="clip"
				>
					{#if clips.length > 1}
						<span
							class="handle"
							aria-hidden="true"
							title="Drag to reorder"
							onpointerdown={(e) => dragStart(e, c.clip.id, i)}
							onpointermove={dragMove}
							onpointerup={dragEnd}
							onpointercancel={dragEnd}>⠿</span
						>
					{/if}
					{#if playable}
						<button
							type="button"
							class="play"
							aria-label={current && player.playing ? `Pause ${title}` : `Play ${title}`}
							onclick={() =>
								current && player.playing ? player.pause() : player.open(piece.id, c.clip.id)}
							>{current && player.playing ? '❚❚' : '▶'}</button
						>
					{:else}
						<!-- eslint-disable svelte/no-navigation-without-resolve -->
						<a
							class="play out"
							href={c.source.url}
							target="_blank"
							rel="noopener noreferrer"
							aria-label={title === info.label
								? `Open ${info.label} (new tab)`
								: `Open ${title} on ${info.label} (new tab)`}>↗</a
						>
						<!-- eslint-enable svelte/no-navigation-without-resolve -->
					{/if}

					<div class="text">
						<span class="title">{title}</span>
						<span class="meta">
							<ProviderIcon provider={c.source.provider} />
							<span>{info.label}{playable ? '' : ' ↗'}</span>
							{#if kind === 'synth'}<span
									class="badge synth"
									data-testid="synth-badge"
									title="Synthesized from the setting’s ABC, not a real recording">♪ Synth</span
								>{/if}
							{#if trim}<span data-testid="clip-trim">{trim}</span>
							{:else if c.source.durationSec}<span>{formatTime(c.source.durationSec)}</span>{/if}
							{#if key && c.clip.key}<span class="key">{formatKey(key)}</span>{/if}
							{#if c.clip.firstNotes}<span class="abc">{c.clip.firstNotes}</span>{/if}
							{#if localOnly && cached}
								<span class="badge warn">Not backed up</span>
							{:else if localOnly && audioFiles.loaded}
								<span class="badge warn">On another device</span>
							{/if}
							{#if audioFiles.downloading.has(c.source.id)}<span class="badge">Downloading…</span
								>{/if}
						</span>
					</div>

					{#if isCacheable(c.source) && c.source.provider !== 'url' && !(localOnly && !cached)}
						<button
							type="button"
							class="icon-btn keep"
							aria-label="Keep offline"
							aria-pressed={audioFiles.kept(c.source.id)}
							title={audioFiles.kept(c.source.id)
								? 'Kept offline on this device'
								: 'Keep offline on this device'}
							onclick={() => toggleKeep(c)}>⤓</button
						>
					{/if}

					<Menu
						label="Actions for {title}"
						items={[
							{ label: 'Edit…', run: () => (editing = c.clip.id) },
							...(openLinkOf(c.source)
								? [{ label: 'Open link ↗', href: openLinkOf(c.source) }]
								: localOnly && cached
									? [{ label: 'Download file', run: () => void downloadRecording(c.source, title) }]
									: []),
							...(playable ? [{ label: 'Trim…', run: () => (trimming = c.clip.id) }] : []),
							...(i > 0
								? [
										{
											label: 'Move up',
											run: () => library.change((d) => moveClipBy(d, piece.id, c.clip.id, -1))
										}
									]
								: []),
							...(i < clips.length - 1
								? [
										{
											label: 'Move down',
											run: () => library.change((d) => moveClipBy(d, piece.id, c.clip.id, 1))
										}
									]
								: []),
							...(localOnly && cached && gdrive.configured
								? [{ label: 'Back up to Drive', run: () => void backUp(c.source.id) }]
								: []),
							{ label: 'Remove', run: () => removeRecording(piece.id, c.clip.id), danger: true }
						]}
					/>
				</li>
			{/each}
		</ol>
	{/if}

	{#if !hasPlayable}
		<AddRecording pieceId={piece.id} prominent />
	{:else if adding}
		<AddRecording
			pieceId={piece.id}
			onadded={() => (adding = false)}
			oncancel={() => (adding = false)}
		/>
	{:else}
		<button type="button" class="btn-quiet add" onclick={() => (adding = true)}
			>+ Add recording</button
		>
	{/if}
</section>

{#if editing}
	<ClipDialog
		pieceId={piece.id}
		clipId={editing}
		onclose={() => (editing = undefined)}
		ontrim={(id) => (trimming = id)}
	/>
{/if}
{#if trimming}
	{@const c = clips.find((x) => x.clip.id === trimming)}
	<TrimDialog
		pieceId={piece.id}
		clipId={trimming}
		title={c ? titleOf(c) : 'recording'}
		onclose={() => (trimming = undefined)}
	/>
{/if}

<style>
	.recordings {
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

	.clips {
		display: grid;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.clip {
		position: relative;
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-1) var(--space-1) var(--space-1) var(--space-2);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-left: 4px solid var(--accent);
		border-radius: var(--radius);
		transition: transform 120ms ease;
	}

	.clip.current {
		border-color: var(--accent);
		border-left-width: 4px;
	}

	.clip.dragging {
		z-index: 2;
		transition: none;
		box-shadow: var(--shadow);
	}

	.handle {
		display: grid;
		place-items: center;
		width: 1.5rem;
		min-height: var(--touch);
		color: var(--color-muted);
		cursor: grab;
		touch-action: none;
		user-select: none;
	}

	.play {
		display: grid;
		place-items: center;
		flex: none;
		width: var(--touch);
		height: var(--touch);
		padding: 0;
		border-radius: 50%;
		background: var(--accent);
		color: var(--color-surface);
		font-size: 1rem;
		text-decoration: none;
	}

	.play.out {
		background: transparent;
		color: var(--accent);
		border: 2px solid var(--accent);
		font-size: 1.125rem;
		font-weight: 700;
	}

	.text {
		flex: 1;
		min-width: 0;
		display: grid;
	}

	.title {
		font-weight: 600;
		overflow-wrap: anywhere;
	}

	.meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0 var(--space-2);
		font-size: 0.8125rem;
		color: var(--color-muted);
	}

	.meta :global(.provider) {
		width: 1.125rem;
		height: 1.125rem;
		font-size: 0.6875rem;
	}

	.key {
		color: var(--color-text);
		font-weight: 600;
	}

	.abc {
		font-family: var(--font-mono);
	}

	.badge {
		padding: 0 0.4rem;
		border-radius: 999px;
		background: var(--color-accent-soft);
		color: var(--color-text);
	}

	.badge.synth {
		color: var(--color-accent);
	}

	.badge.warn {
		background: color-mix(in srgb, var(--color-star) 22%, transparent);
	}

	.keep[aria-pressed='true'] {
		color: var(--color-accent);
		background: var(--color-accent-soft);
	}

	.add {
		justify-self: start;
	}
</style>
