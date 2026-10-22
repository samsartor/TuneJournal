<!--
	Shown instead of SvelteKit's bare "500 Internal Error" when a page fails to load or render. The
	library is safe (it lives in IndexedDB), so this says what went wrong and offers a way back.
-->
<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';

	const notFound = $derived(page.status === 404);
	const message = $derived(page.error?.message || 'Something went wrong.');
</script>

<svelte:head><title>{notFound ? 'Not found' : 'Error'} · TuneJournal</title></svelte:head>

<main class="error-page" data-testid="error-page">
	<h1>{notFound ? 'Page not found' : 'Something went wrong'}</h1>
	<p class="muted">
		{notFound
			? 'There’s nothing at this address.'
			: 'This page hit an error. Your library is safe on this device.'}
	</p>
	{#if !notFound}
		<p class="message" data-testid="error-message"><code>{message}</code></p>
	{/if}
	<div class="actions">
		<a class="btn-link" href={resolve('/(main)')}>Back to list</a>
		{#if !notFound}
			<button type="button" class="btn-quiet" onclick={() => location.reload()}>Reload</button>
		{/if}
	</div>
</main>

<style>
	.error-page {
		display: grid;
		gap: var(--space-3);
		max-width: 36rem;
		margin: 0 auto;
		padding: var(--space-4) var(--space-3);
	}

	h1,
	p {
		margin: 0;
	}

	h1 {
		font-size: 1.5rem;
	}

	.message {
		padding: var(--space-2) var(--space-3);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.btn-link {
		display: inline-grid;
		place-items: center;
		min-height: var(--touch);
		padding: 0 var(--space-3);
		border-radius: var(--radius);
		background: var(--color-accent);
		color: var(--color-on-accent);
		text-decoration: none;
	}
</style>
