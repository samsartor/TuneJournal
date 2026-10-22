<script lang="ts">
	interface Item {
		label: string;
		run: () => void;
		danger?: boolean;
	}

	let { label, items }: { label: string; items: Item[] } = $props();

	let open = $state(false);
	let root: HTMLElement;
	let toggle: HTMLButtonElement;

	function choose(item: Item) {
		open = false;
		item.run();
	}

	function outside(e: PointerEvent) {
		if (open && !root.contains(e.target as Node)) open = false;
	}

	function keydown(e: KeyboardEvent) {
		if (open && e.key === 'Escape') {
			open = false;
			toggle.focus();
		}
	}
</script>

<svelte:window onpointerdown={outside} onkeydown={keydown} />

<div class="menu" bind:this={root}>
	<button
		bind:this={toggle}
		type="button"
		class="icon-btn"
		aria-label={label}
		aria-haspopup="menu"
		aria-expanded={open}
		onclick={() => (open = !open)}>⋯</button
	>
	{#if open}
		<div class="items" role="menu">
			{#each items as item (item.label)}
				<button
					type="button"
					role="menuitem"
					class:danger={item.danger}
					onclick={() => choose(item)}>{item.label}</button
				>
			{/each}
		</div>
	{/if}
</div>

<style>
	.menu {
		position: relative;
	}

	.items {
		position: absolute;
		right: 0;
		bottom: calc(100% + 4px);
		z-index: 20;
		display: grid;
		min-width: 9rem;
		padding: var(--space-1);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		box-shadow: var(--shadow);
	}

	.items button {
		background: transparent;
		color: var(--color-text);
		text-align: left;
	}

	.items button:hover {
		background: var(--color-accent-soft);
	}

	.items .danger {
		color: var(--color-danger);
	}
</style>
