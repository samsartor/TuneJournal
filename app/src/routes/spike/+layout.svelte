<script lang="ts">
	import { resolve } from '$app/paths';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

<div class="spike">
	<nav><a href={resolve('/spike')}>← Spikes</a></nav>
	{@render children()}
</div>

<style>
	.spike {
		max-width: 48rem;
		margin: 0 auto;
		padding: var(--space-3);
	}

	.spike :global(a) {
		color: var(--color-accent);
	}

	.spike :global(input),
	.spike :global(select) {
		font: inherit;
		min-height: 2.25rem;
	}

	.spike :global(.row) {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		align-items: center;
		margin: var(--space-2) 0;
	}

	.spike :global(pre) {
		overflow: auto;
		max-height: 20rem;
		padding: var(--space-2);
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		font-size: 0.8rem;
	}

	.spike :global(.ok) {
		color: green;
	}

	.spike :global(.err) {
		color: crimson;
	}
</style>
