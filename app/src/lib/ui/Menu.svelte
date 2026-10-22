<!--
	An overflow (⋯) menu. The list is fixed to the viewport rather than to the button, so a scrolling
	pane or a dialog never clips it: it opens below the button when there's room (else above,
	whichever side has more), stays inside the viewport horizontally, and scrolls when it's taller
	than the space it has. An item can run a function, or be a link that opens in a new tab.
-->
<script lang="ts">
	import { tick } from 'svelte';
	import { placeMenu, type MenuItem, type MenuPlacement } from './menu.ts';

	let { label, items }: { label: string; items: MenuItem[] } = $props();

	let open = $state(false);
	let place = $state<MenuPlacement>();
	let root: HTMLElement;
	let toggle: HTMLButtonElement;
	let list = $state<HTMLElement>();

	async function show() {
		open = true;
		place = undefined;
		await tick();
		position();
	}

	function position() {
		if (!open || !list) return;
		const anchor = toggle.getBoundingClientRect();
		// Measure at its natural size, then constrain.
		list.style.maxHeight = 'none';
		const size = { width: list.offsetWidth, height: list.scrollHeight };
		const viewport = document.documentElement;
		place = placeMenu(anchor, size, {
			width: viewport.clientWidth,
			height: window.innerHeight
		});
		list.style.maxHeight = '';
	}

	function choose(item: MenuItem) {
		open = false;
		item.run?.();
	}

	function outside(e: PointerEvent) {
		if (open && !root.contains(e.target as Node)) open = false;
	}

	function keydown(e: KeyboardEvent) {
		if (open && e.key === 'Escape') {
			// Don't also close a surrounding dialog.
			e.preventDefault();
			e.stopPropagation();
			open = false;
			toggle.focus();
		}
	}
</script>

<svelte:window onpointerdown={outside} onresize={position} />
<svelte:document onscrollcapture={position} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="menu" bind:this={root} onkeydown={keydown}>
	<button
		bind:this={toggle}
		type="button"
		class="icon-btn"
		aria-label={label}
		aria-haspopup="menu"
		aria-expanded={open}
		onclick={() => (open ? (open = false) : void show())}>⋯</button
	>
	{#if open}
		<div
			class="items"
			class:placed={!!place}
			role="menu"
			bind:this={list}
			style:top={place?.top !== undefined ? `${place.top}px` : undefined}
			style:bottom={place?.bottom !== undefined ? `${place.bottom}px` : undefined}
			style:left={place ? `${place.left}px` : undefined}
			style:max-height={place ? `${place.maxHeight}px` : undefined}
		>
			{#each items as item, i (i)}
				{#if item.href}
					<!-- eslint-disable svelte/no-navigation-without-resolve -- external links -->
					<a
						role="menuitem"
						href={item.href}
						target="_blank"
						rel="noopener noreferrer"
						class:danger={item.danger}
						onclick={() => choose(item)}>{item.label}</a
					>
					<!-- eslint-enable svelte/no-navigation-without-resolve -->
				{:else}
					<button
						type="button"
						role="menuitem"
						class:danger={item.danger}
						onclick={() => choose(item)}>{item.label}</button
					>
				{/if}
			{/each}
		</div>
	{/if}
</div>

<style>
	.menu {
		position: relative;
	}

	.items {
		position: fixed;
		z-index: 100;
		display: grid;
		min-width: 9rem;
		max-width: calc(100vw - 16px);
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: var(--space-1);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		box-shadow: var(--shadow);
		/* Hidden for the one frame between opening and measuring. */
		visibility: hidden;
	}

	.items.placed {
		visibility: visible;
	}

	.items button,
	.items a {
		display: flex;
		align-items: center;
		min-height: var(--touch);
		padding: 0 var(--space-3);
		border-radius: var(--radius);
		background: transparent;
		color: var(--color-text);
		text-align: left;
		text-decoration: none;
		white-space: nowrap;
	}

	.items button:hover,
	.items a:hover {
		background: var(--color-accent-soft);
	}

	.items .danger {
		color: var(--color-danger);
	}
</style>
