<!--
	The persistent mini-player (PLAN.md §6.6). Fixed to the bottom of every page; it publishes its
	height as --player-h so pages, toasts and the floating buttons sit above it.
-->
<script lang="ts">
	import { onDestroy } from 'svelte';
	import { resolve } from '$app/paths';
	import { formatRate, formatTime } from '#lib/audio/bounds.ts';
	import { player } from '#lib/audio/player.svelte.ts';
	import { untitled } from '#lib/domain/format.ts';
	import { formatKey } from '#lib/domain/key.ts';
	import { recordingTitle } from '#lib/domain/providers.ts';
	import { library } from '#lib/store/library.svelte.ts';
	import { oembed } from '#lib/store/oembed.svelte.ts';
	import ProviderIcon from './ProviderIcon.svelte';
	import SpeedControl from './SpeedControl.svelte';

	let bar = $state<HTMLElement>();
	let videoHost = $state<HTMLElement>();
	let speedOpen = $state(false);

	const current = $derived(player.current);
	const piece = $derived(current ? library.doc?.pieces[current.pieceId] : undefined);
	const clip = $derived(current ? piece?.clips[current.clipId] : undefined);
	const source = $derived(current ? library.doc?.sources[current.sourceId] : undefined);
	const looked = $derived(source ? oembed.lookup(source) : undefined);
	const title = $derived(
		clip && source ? recordingTitle(clip, source, looked?.title) : 'Recording'
	);
	const key = $derived(
		piece && clip && library.index ? library.index.clipKey(piece, clip) : undefined
	);
	const bounds = $derived(player.bounds);
	const end = $derived(Number.isFinite(bounds.end) ? bounds.end : bounds.start + 1);

	$effect(() => {
		player.setVideoHost(videoHost);
	});

	// Follow edits to the clip (a saved trim), and stop if it's removed.
	$effect(() => {
		if (current && library.doc) player.syncClip(clip);
	});

	// Publish the bar's height for the layout.
	$effect(() => {
		const el = bar;
		const root = document.documentElement;
		if (!el) {
			root.style.setProperty('--player-h', '0px');
			return;
		}
		const observer = new ResizeObserver(() =>
			root.style.setProperty('--player-h', `${el.offsetHeight}px`)
		);
		observer.observe(el);
		return () => {
			observer.disconnect();
			root.style.setProperty('--player-h', '0px');
		};
	});

	onDestroy(() => player.close());
</script>

{#if current}
	<section
		class="player"
		bind:this={bar}
		aria-label="Player"
		data-testid="player"
		data-time={player.time.toFixed(2)}
		data-start={bounds.start.toFixed(2)}
		data-end={Number.isFinite(bounds.end) ? bounds.end.toFixed(2) : ''}
		data-playing={player.playing}
		data-rate={player.rate}
		data-loop={player.loop}
		data-kind={player.kind}
		data-rendered-tempo={player.renderedTempo ?? ''}
	>
		<div class="row">
			<div class="video" class:shown={player.kind === 'youtube'} bind:this={videoHost}></div>
			<button
				type="button"
				class="play"
				aria-label={player.playing ? 'Pause' : 'Play'}
				disabled={player.loading || !!player.error}
				onclick={() => player.toggle()}
			>
				{#if player.loading}<span class="spinner" aria-hidden="true"
					></span>{:else if player.playing}❚❚{:else}▶{/if}
			</button>

			<div class="info">
				<div class="names">
					{#if source}<ProviderIcon provider={source.provider} />{/if}
					<span class="title" data-testid="player-title">{title}</span>
					{#if player.kind === 'synth'}<span
							class="synth"
							data-testid="synth-badge"
							title="Synthesized from the setting’s ABC, not a real recording">♪ Synth</span
						>{/if}
					{#if piece}
						<a class="piece" href={resolve('/(main)/piece/[id]', { id: piece.id })}
							>{piece.title ?? untitled(piece.kind)}{#if key}&nbsp;· {formatKey(key)}{/if}</a
						>
					{/if}
				</div>
				{#if player.error}
					<p class="error" role="alert">{player.error}</p>
				{:else}
					<div class="scrub">
						<span class="time">{formatTime(player.time)}</span>
						<input
							type="range"
							aria-label="Position"
							aria-valuetext="{formatTime(player.time)} of {formatTime(end)}"
							min={bounds.start}
							max={end}
							step="0.1"
							value={Math.min(Math.max(player.time, bounds.start), end)}
							disabled={player.loading}
							oninput={(e) => player.seek(Number(e.currentTarget.value))}
						/>
						<span class="time">{formatTime(end)}</span>
					</div>
				{/if}
			</div>

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
				class="btn-quiet rate"
				aria-label="Speed {formatRate(player.rate)}"
				aria-expanded={speedOpen}
				aria-controls="player-speed"
				onclick={() => (speedOpen = !speedOpen)}>{formatRate(player.rate)}</button
			>
			<button
				type="button"
				class="icon-btn close"
				aria-label="Close player"
				onclick={() => player.close()}>×</button
			>
		</div>
		<div class="speed-panel" class:open={speedOpen} id="player-speed">
			<SpeedControl rate={player.rate} onchange={(r) => player.setRate(r)} />
		</div>
	</section>
{/if}

<style>
	.player {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 40;
		display: grid;
		gap: var(--space-1);
		padding: var(--space-1) var(--space-2) calc(var(--space-1) + env(safe-area-inset-bottom));
		background: var(--color-surface);
		border-top: 1px solid var(--color-border);
		box-shadow: var(--shadow);
	}

	.row {
		display: flex;
		align-items: center;
		gap: var(--space-1);
	}

	.video {
		display: none;
		flex: none;
		width: 4.5rem;
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

	.play {
		flex: none;
		width: 3rem;
		height: 3rem;
		padding: 0;
		border-radius: 50%;
		font-size: 1.125rem;
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

	.info {
		flex: 1 1 0;
		width: 0;
		min-width: 0;
		display: grid;
		overflow: hidden;
	}

	.names {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		min-width: 0;
		font-size: 0.875rem;
	}

	.title {
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
		flex: 0 1 auto;
	}

	.synth {
		flex: none;
		padding: 0 0.4rem;
		border-radius: 999px;
		background: var(--color-accent-soft);
		font-size: 0.75rem;
		white-space: nowrap;
	}

	.piece {
		flex: 1 1 0;
		min-width: 3rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--color-muted);
		text-decoration: none;
	}

	.scrub {
		display: flex;
		align-items: center;
		gap: var(--space-1);
	}

	.scrub input {
		flex: 1;
		min-width: 0;
		min-height: 2rem;
	}

	.time {
		font-size: 0.75rem;
		color: var(--color-muted);
		font-variant-numeric: tabular-nums;
	}

	.error {
		margin: 0;
		color: var(--color-danger);
		font-size: 0.875rem;
	}

	.loop[aria-pressed='true'] {
		color: var(--color-accent);
		background: var(--color-accent-soft);
	}

	.rate {
		flex: none;
		padding: 0 var(--space-2);
		font-variant-numeric: tabular-nums;
	}

	.speed-panel {
		display: none;
		padding: var(--space-1) 0;
	}

	.speed-panel.open {
		display: block;
	}

	/* Desktop: one row, with the speed control inline between the scrubber and loop. */
	@media (min-width: 52rem) {
		.player {
			display: flex;
			align-items: center;
			gap: var(--space-2);
			padding-left: var(--space-3);
			padding-right: var(--space-3);
		}

		.row {
			display: contents;
		}

		.video {
			width: 8rem;
		}

		.rate {
			display: none;
		}

		.speed-panel {
			display: block;
			order: 1;
			padding: 0;
		}

		.loop {
			order: 2;
		}

		.close {
			order: 3;
		}
	}
</style>
