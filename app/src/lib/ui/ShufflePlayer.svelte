<!--
	Shuffle's own player (PLAN.md §6.5): a recording picker, a big play/pause, the large speed
	control, loop and a scrubber. It drives the global player store, so speed and loop carry over
	from one card to the next. Pieces without anything playable get their links, or "No recordings".
	Mount it with a {#key} on the piece, so each card starts on its first playable recording.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { formatTime } from '#lib/audio/bounds.ts';
	import { player } from '#lib/audio/player.svelte.ts';
	import type { LibraryIndex } from '#lib/domain/derived.ts';
	import { formatKey } from '#lib/domain/key.ts';
	import { PROVIDERS, isPlayable, recordingTitle } from '#lib/domain/providers.ts';
	import type { ClipId, Piece } from '#lib/domain/types.ts';
	import { oembed } from '#lib/store/oembed.svelte.ts';
	import ProviderIcon from './ProviderIcon.svelte';
	import SpeedControl from './SpeedControl.svelte';

	let { piece, index }: { piece: Piece; index: LibraryIndex } = $props();

	let videoHost = $state<HTMLElement>();

	const clips = $derived(index.clipsOf(piece));
	const playable = $derived(clips.filter(({ source }) => isPlayable(source)));
	const links = $derived(clips.filter(({ source }) => !isPlayable(source)));
	const pieceKey = $derived(index.effectiveKey(piece));

	let chosen = $state<ClipId>();
	const selected = $derived(playable.find((c) => c.clip.id === chosen) ?? playable[0]);
	const selectedId = $derived(selected?.clip.id);
	const current = $derived(!!selectedId && player.isCurrent(piece.id, selectedId));
	const bounds = $derived(player.bounds);
	const end = $derived(Number.isFinite(bounds.end) ? bounds.end : bounds.start + 1);

	function titleOf(c: (typeof clips)[number]) {
		return recordingTitle(c.clip, c.source, oembed.lookup(c.source)?.title);
	}

	/** The recording's key, when it's played in a different key from the piece's usual one. */
	function otherKey(c: (typeof clips)[number]) {
		const key = index.clipKey(piece, c.clip);
		return key && key !== pieceKey ? key : undefined;
	}

	function optionLabel(c: (typeof clips)[number]) {
		const key = otherKey(c);
		return key ? `${titleOf(c)} · in ${formatKey(key)}` : titleOf(c);
	}

	// The YouTube player needs somewhere to live; the mini-player bar isn't shown in Shuffle.
	$effect(() => {
		player.setVideoHost(videoHost);
	});

	// Load the chosen recording, paused, so play starts at once and the scrubber shows its length.
	$effect(() => {
		const id = selectedId;
		if (id) untrack(() => void player.open(piece.id, id, { autoplay: false }));
	});

	export function toggle() {
		if (!selectedId) return;
		if (current) player.toggle();
		else void player.open(piece.id, selectedId);
	}
</script>

<section
	class="shuffle-player"
	aria-label="Player"
	data-testid="shuffle-player"
	data-time={current ? player.time.toFixed(2) : ''}
	data-playing={current && player.playing}
	data-rate={player.rate}
	data-loop={player.loop}
	data-kind={current ? player.kind : ''}
>
	{#if selected}
		<div
			class="video"
			class:shown={current && player.kind === 'youtube'}
			bind:this={videoHost}
		></div>

		<div class="pick">
			{#if playable.length > 1}
				<label class="visually-hidden" for="shuffle-recording">Recording</label>
				<select
					id="shuffle-recording"
					value={selectedId}
					onchange={(e) => (chosen = e.currentTarget.value as ClipId)}
				>
					{#each playable as c (c.clip.id)}<option value={c.clip.id}>{optionLabel(c)}</option
						>{/each}
				</select>
			{:else}
				<p class="only" data-testid="shuffle-recording">
					<ProviderIcon provider={selected.source.provider} />
					<span>{titleOf(selected)}</span>
				</p>
			{/if}
			{#if otherKey(selected)}
				<p class="clip-key" data-testid="clip-key">
					This recording is in <strong>{formatKey(otherKey(selected)!)}</strong>
				</p>
			{/if}
		</div>

		<div class="transport">
			<button
				type="button"
				class="icon-btn loop"
				aria-label="Loop"
				aria-pressed={player.loop}
				title="Loop"
				onclick={() => player.setLoop(!player.loop)}>⟲</button
			>
			<button
				type="button"
				class="play"
				aria-label={current && player.playing ? 'Pause' : 'Play'}
				disabled={current && (player.loading || !!player.error)}
				onclick={toggle}
			>
				{#if current && player.loading}<span class="spinner" aria-hidden="true"
					></span>{:else if current && player.playing}❚❚{:else}▶{/if}
			</button>
			<span class="spacer" aria-hidden="true"></span>
		</div>

		{#if current && player.error}
			<p class="error" role="alert">{player.error}</p>
		{:else}
			<div class="scrub">
				<span class="time">{formatTime(current ? player.time : bounds.start)}</span>
				<input
					type="range"
					aria-label="Position"
					aria-valuetext="{formatTime(player.time)} of {formatTime(end)}"
					min={bounds.start}
					max={end}
					step="0.1"
					value={current ? Math.min(Math.max(player.time, bounds.start), end) : bounds.start}
					disabled={!current || player.loading}
					oninput={(e) => player.seek(Number(e.currentTarget.value))}
				/>
				<span class="time">{formatTime(end)}</span>
			</div>
		{/if}

		<SpeedControl size="large" rate={player.rate} onchange={(r) => player.setRate(r)} />
	{:else if links.length > 0}
		<ul class="links" aria-label="Recordings elsewhere">
			{#each links as c (c.clip.id)}
				{@const info = PROVIDERS[c.source.provider]}
				{@const title = titleOf(c)}
				<li>
					<!-- eslint-disable svelte/no-navigation-without-resolve -->
					<a
						class="out"
						style:--accent="var(--provider-{c.source.provider})"
						href={c.source.url}
						target="_blank"
						rel="noopener noreferrer"
						><ProviderIcon provider={c.source.provider} label={false} />
						<span>{title === info.label ? info.label : `${title} · ${info.label}`}</span>
						<span aria-hidden="true">↗</span><span class="visually-hidden">(new tab)</span></a
					>
					<!-- eslint-enable svelte/no-navigation-without-resolve -->
				</li>
			{/each}
		</ul>
	{:else}
		<p class="none muted">No recordings</p>
	{/if}
</section>

<style>
	.shuffle-player {
		display: grid;
		gap: var(--space-3);
		padding: var(--space-3);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
	}

	.video {
		display: none;
		width: 100%;
		max-width: 28rem;
		justify-self: center;
		aspect-ratio: 16 / 9;
		border-radius: calc(var(--radius) * 0.5);
		overflow: hidden;
		background: #000;
	}

	.video.shown {
		display: block;
	}

	.video :global(iframe) {
		display: block;
		width: 100%;
		height: 100%;
		border: 0;
	}

	.pick {
		display: grid;
		gap: var(--space-1);
	}

	.pick select {
		width: 100%;
	}

	.only {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		margin: 0;
		font-weight: 600;
		overflow-wrap: anywhere;
	}

	.clip-key {
		margin: 0;
		text-align: center;
		color: var(--color-muted);
		font-size: 0.9375rem;
	}

	.clip-key strong {
		color: var(--color-text);
	}

	.transport {
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: center;
		justify-items: center;
	}

	.loop {
		justify-self: end;
		margin-right: var(--space-4);
		width: 3.5rem;
		height: 3.5rem;
		border-radius: 50%;
		font-size: 1.5rem;
	}

	.loop[aria-pressed='true'] {
		color: var(--color-accent);
		background: var(--color-accent-soft);
	}

	.play {
		display: grid;
		place-items: center;
		width: 5rem;
		height: 5rem;
		padding: 0;
		border-radius: 50%;
		font-size: 1.75rem;
		box-shadow: var(--shadow);
	}

	.spinner {
		display: inline-block;
		width: 1.5rem;
		height: 1.5rem;
		border: 3px solid currentColor;
		border-right-color: transparent;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.scrub {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.scrub input {
		flex: 1;
		min-width: 0;
	}

	.time {
		font-size: 0.875rem;
		color: var(--color-muted);
		font-variant-numeric: tabular-nums;
	}

	.error {
		margin: 0;
		color: var(--color-danger);
		text-align: center;
	}

	.links {
		display: grid;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.out {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		min-height: 3rem;
		padding: 0 var(--space-3);
		border: 2px solid var(--accent);
		border-radius: var(--radius);
		color: var(--accent);
		font-weight: 600;
		text-decoration: none;
		overflow-wrap: anywhere;
	}

	.none {
		margin: 0;
		padding: var(--space-3) 0;
		text-align: center;
	}
</style>
