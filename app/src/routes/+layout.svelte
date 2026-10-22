<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { library } from '#lib/store/library.svelte.ts';
	import { pwaUpdate } from '#lib/pwa/update.svelte.ts';
	import { audioFiles } from '#lib/store/audio.svelte.ts';
	import { gdrive } from '#lib/store/gdrive.svelte.ts';
	import PlayerBar from '#lib/ui/PlayerBar.svelte';
	import Toasts from '#lib/ui/Toasts.svelte';
	import { ui } from '#lib/ui/state.svelte.ts';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	onMount(() => {
		library.load();
		pwaUpdate.start();
		ui.startClock();
		gdrive.init();
		void audioFiles.refresh();
	});
</script>

{@render children()}

<PlayerBar />
<Toasts />
