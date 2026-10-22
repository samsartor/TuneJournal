<script lang="ts">
	import { onMount } from 'svelte';
	import {
		deleteFile,
		getFile,
		listFiles,
		opfsAvailable,
		type StoredFile
	} from '#lib/spike/file-store.ts';
	import { SHARE_DIR } from '#lib/spike/share-target.ts';

	let files = $state.raw<StoredFile[]>([]);
	let urls = $state<Record<string, string>>({});
	let texts = $state<Record<string, string>>({});
	let params = $state<Record<string, string>>({});
	let env = $state<Record<string, string | boolean>>({});

	async function refresh() {
		files = await listFiles(SHARE_DIR);
		for (const f of files) {
			const key = `${f.backend}:${f.name}`;
			if (urls[key] || texts[key]) continue;
			const blob = await getFile(f);
			if (f.type.startsWith('text/')) texts[key] = await blob.text();
			else urls[key] = URL.createObjectURL(blob);
		}
	}

	async function remove(f: StoredFile) {
		await deleteFile(f);
		await refresh();
	}

	onMount(() => {
		params = Object.fromEntries(new URLSearchParams(location.search));
		env = {
			standalone: matchMedia('(display-mode: standalone)').matches,
			swControlled: !!navigator.serviceWorker?.controller,
			opfs: opfsAvailable(),
			secureContext: isSecureContext
		};
		refresh();
	});
</script>

<h1>Share target inbox</h1>

<p>
	Install the app, then share an audio file to <b>TuneJournal</b> from another app (e.g. Pixel Recorder
	→ Share → Audio file). It lands here.
</p>

<pre>{JSON.stringify({ params, env }, null, 1)}</pre>

{#if params.error}<p class="err">Error: {params.error}</p>{/if}
{#if params.received}<p class="ok">Received {params.received} file(s) via {params.backend}.</p>{/if}

<div class="row"><button onclick={refresh}>Refresh</button></div>

{#if files.length === 0}
	<p>No shared files yet.</p>
{/if}
<ul>
	{#each files as f (f.backend + f.name)}
		{@const key = `${f.backend}:${f.name}`}
		<li>
			<div>
				<b>{f.name}</b> — {f.type || 'no type'}, {(f.size / 1024).toFixed(1)} KiB, {f.backend}
				<button onclick={() => remove(f)}>Delete</button>
			</div>
			{#if texts[key]}<pre>{texts[key]}</pre>{/if}
			{#if urls[key]}<audio controls src={urls[key]}></audio>{/if}
		</li>
	{/each}
</ul>
