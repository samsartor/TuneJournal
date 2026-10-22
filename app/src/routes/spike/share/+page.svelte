<script lang="ts">
	// M4 moved the share target into the app: shares now land on /shared. This spike page only
	// forwards there (keeping ?received=… from an old WebAPK's redirect).
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';

	onMount(() => {
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- resolved, plus the query
		void goto(`${resolve('/shared')}${location.search}`, { replaceState: true });
	});
</script>

<h1>Share target inbox</h1>
<p>Shared files now land on <a href={resolve('/shared')}>the Shared recording page</a>.</p>
