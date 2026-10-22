<script lang="ts">
	import { pwaUpdate } from '#lib/pwa/update.svelte.ts';
	import { ui } from './state.svelte.ts';
</script>

<div class="toasts" role="status" aria-live="polite">
	{#if ui.toast}
		{@const toast = ui.toast}
		<div class="toast">
			<span>{toast.message}</span>
			{#if toast.action}
				<button
					type="button"
					onclick={() => {
						toast.action?.run();
						ui.dismissToast();
					}}>{toast.action.label}</button
				>
			{/if}
			<button type="button" class="icon-btn" aria-label="Dismiss" onclick={() => ui.dismissToast()}
				>×</button
			>
		</div>
	{/if}
	{#if pwaUpdate.updateAvailable}
		<div class="toast">
			<span>Update available</span>
			<button type="button" onclick={() => pwaUpdate.applyUpdate()}>Reload</button>
		</div>
	{/if}
</div>

<style>
	.toasts {
		position: fixed;
		left: 50%;
		bottom: calc(var(--space-3) + env(safe-area-inset-bottom));
		transform: translateX(-50%);
		z-index: 50;
		display: grid;
		gap: var(--space-2);
		width: max-content;
		max-width: calc(100% - 2 * var(--space-3));
	}

	.toast {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-1) var(--space-1) var(--space-1) var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-surface);
		box-shadow: var(--shadow);
	}

	.toast span {
		flex: 1;
		min-width: 0;
		overflow-wrap: anywhere;
	}

	/* On phones, sit above the floating add/shuffle buttons. */
	@media (max-width: 51.99rem) {
		.toasts {
			bottom: calc(5rem + env(safe-area-inset-bottom));
		}
	}
</style>
