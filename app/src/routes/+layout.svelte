<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { library } from '#lib/store/library.svelte.ts';
	import { pwaUpdate } from '#lib/pwa/update.svelte.ts';
	import Toasts from '#lib/ui/Toasts.svelte';
	import { ui } from '#lib/ui/state.svelte.ts';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	onMount(() => {
		library.load();
		pwaUpdate.start();
		ui.startClock();
	});
</script>

{@render children()}

<Toasts />
