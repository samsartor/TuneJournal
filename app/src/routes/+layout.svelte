<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { library } from '#lib/store/library.svelte.ts';
	import { pwaUpdate } from '#lib/pwa/update.svelte.ts';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	onMount(() => {
		library.load();
		pwaUpdate.start();
	});
</script>

{@render children()}

{#if pwaUpdate.updateAvailable}
	<div class="toast" role="status">
		<span>Update available</span>
		<button onclick={() => pwaUpdate.applyUpdate()}>Reload</button>
	</div>
{/if}

<style>
	.toast {
		position: fixed;
		left: 50%;
		bottom: calc(var(--space-3) + env(safe-area-inset-bottom));
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-2) var(--space-2) var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-surface);
		box-shadow: 0 4px 16px rgb(0 0 0 / 0.15);
	}
</style>
