<script lang="ts">
	import { page } from '$app/state';
	import EditModal from '#lib/ui/EditModal.svelte';
	import ListPane from '#lib/ui/ListPane.svelte';
	import MergeDialog from '#lib/ui/MergeDialog.svelte';
	import MergePicker from '#lib/ui/MergePicker.svelte';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	const selectedId = $derived(page.params.id);
</script>

<div class="shell" class:has-detail={!!selectedId}>
	<section class="list" aria-label="Library">
		<ListPane {selectedId} />
	</section>
	<section class="pane" aria-label="Details">
		{@render children()}
	</section>
</div>

<EditModal />
<MergePicker />
<MergeDialog />

<style>
	/* Mobile: one view at a time; the detail route replaces the list. */
	@media (max-width: 51.99rem) {
		.shell.has-detail .list,
		.shell:not(.has-detail) .pane {
			display: none;
		}
	}

	/* Desktop: list on the left, detail on the right, each scrolling on its own (§6.0). */
	@media (min-width: 52rem) {
		.shell {
			display: grid;
			grid-template-columns: minmax(22rem, 28rem) 1fr;
			/* The player bar sits below, outside the two scrolling panes. */
			height: calc(100dvh - var(--player-h));
		}

		.list,
		.pane {
			/* Positioned, so absolutely positioned descendants (.visually-hidden labels, the hidden
			   file input) are laid out inside the pane that scrolls them. Otherwise their containing
			   block is the page, and the page itself scrolls past the end of the layout. */
			position: relative;
			overflow-y: auto;
			overscroll-behavior: contain;
		}

		.list {
			border-right: 1px solid var(--color-border);
		}
	}
</style>
