<script lang="ts">
	import { relativeTime } from '#lib/domain/format.ts';
	import { sync } from '#lib/store/sync.svelte.ts';
	import { ui } from './state.svelte.ts';

	/** `verbose` spells out the details under the label, for Settings; otherwise they're a tooltip. */
	let { verbose = false }: { verbose?: boolean } = $props();

	const detail = $derived(
		sync.state === 'offline'
			? sync.online
				? `Can’t reach the sync server (${sync.server}). Changes are saved on this device and will sync once it’s reachable.`
				: 'This device is offline. Changes are saved on this device and will sync when you’re back online.'
			: sync.state === 'connecting'
				? `Connecting to the sync server (${sync.server})…`
				: `Connected to the sync server (${sync.server}).${
						sync.behind
							? ' Sending and receiving changes…'
							: sync.lastSyncAt
								? ` Last synced ${relativeTime(sync.lastSyncAt, ui.now)}.`
								: ''
					}`
	);
</script>

<span
	class="sync"
	class:verbose
	data-state={sync.state}
	data-testid="sync-status"
	title={verbose ? undefined : detail}
>
	<span class="dot" aria-hidden="true"></span>
	<span class="label">{sync.label}</span>
	{#if verbose}
		<span class="detail" data-testid="sync-detail">{detail}</span>
	{:else}
		<span class="visually-hidden">: {detail}</span>
	{/if}
</span>

<style>
	.sync {
		display: inline-flex;
		align-items: center;
		gap: 0.4em;
		color: var(--color-muted);
		font-size: 0.8125rem;
		white-space: nowrap;
	}

	.verbose {
		display: grid;
		grid-template-columns: auto 1fr;
		align-items: center;
		color: var(--color-text);
		font-size: 1rem;
		white-space: normal;
	}

	.verbose .detail {
		grid-column: 2;
		color: var(--color-muted);
		font-size: 0.875rem;
	}

	.dot {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		background: var(--color-muted);
	}

	[data-state='connected'] .dot {
		background: var(--color-accent);
	}

	[data-state='connecting'] .dot {
		background: var(--color-star);
		animation: pulse 1.2s ease-in-out infinite;
	}

	[data-state='offline'] .dot {
		background: transparent;
		box-shadow: inset 0 0 0 1.5px var(--color-muted);
	}

	@keyframes pulse {
		50% {
			opacity: 0.35;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		[data-state='connecting'] .dot {
			animation: none;
		}
	}
</style>
