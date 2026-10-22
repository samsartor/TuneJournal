<script lang="ts">
	// Milestone 0 integration spike (PLAN.md §7.1). Throwaway: delete src/routes/spike and
	// src/lib/spike when done.
	import { resolve } from '$app/paths';

	const pages = [
		['/spike/thesession', 'thesession.org search, tune, sets, recordings from the browser'],
		['/spike/drive', 'Google Drive: GIS token + Picker, download to OPFS, play, upload'],
		['/spike/share', 'Web Share Target inbox (files shared into the installed PWA)'],
		['/spike/youtube', 'YouTube IFrame clip playback, rates, loop, oEmbed'],
		['/spike/speed', 'Slow-down quality with preservesPitch'],
		['/spike/sync', 'Automerge sync through sync.automerge.org']
	] as const;
</script>

<h1>Integration spikes</h1>
<ul>
	{#each pages as [route, label] (route)}
		<li><a href={resolve(route)}>{route.slice(7)}</a> — {label}</li>
	{/each}
</ul>
