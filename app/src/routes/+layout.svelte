<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { library } from '#lib/store/library.svelte.ts';
	import { pwaUpdate } from '#lib/pwa/update.svelte.ts';
	import { audioFiles } from '#lib/store/audio.svelte.ts';
	import { gdrive } from '#lib/store/gdrive.svelte.ts';
	import PlayerBar from '#lib/ui/PlayerBar.svelte';
	import Toasts from '#lib/ui/Toasts.svelte';
	import { ui } from '#lib/ui/state.svelte.ts';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	// Shuffle is full-screen with a player of its own (§6.5), so the mini-player bar steps aside.
	const fullScreen = $derived(page.route.id?.startsWith('/shuffle') ?? false);

	onMount(() => {
		library.load();
		pwaUpdate.start();
		ui.startClock();
		gdrive.init();
		void audioFiles.refresh();
	});
</script>

{@render children()}

{#if !fullScreen}<PlayerBar />{/if}
<Toasts />
