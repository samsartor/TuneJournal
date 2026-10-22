<script lang="ts">
	import { onMount } from 'svelte';
	import { getFile, listFiles, type StoredFile } from '#lib/spike/file-store.ts';

	const PRESETS = [0.5, 0.6, 0.75, 0.9, 1];

	let audio = $state<HTMLAudioElement>();
	let src = $state<string>();
	let label = $state('');
	let rate = $state(1);
	let preservesPitch = $state(true);
	let loop = $state(true);
	let stored = $state.raw<StoredFile[]>([]);
	let support = $state<Record<string, unknown>>({});
	let error = $state('');

	function use(blob: Blob, name: string) {
		if (src) URL.revokeObjectURL(src);
		src = URL.createObjectURL(blob);
		label = `${name} (${blob.type || 'unknown type'}, ${(blob.size / 1024 / 1024).toFixed(2)} MiB)`;
	}

	function setRate(r: number) {
		rate = Math.min(2, Math.max(0.25, Math.round(r * 100) / 100));
	}

	$effect(() => {
		if (!audio) return;
		audio.preservesPitch = preservesPitch;
		(audio as HTMLAudioElement & { webkitPreservesPitch?: boolean }).webkitPreservesPitch =
			preservesPitch;
		audio.playbackRate = rate;
		audio.defaultPlaybackRate = rate;
	});

	onMount(async () => {
		const a = document.createElement('audio');
		support = {
			userAgent: navigator.userAgent,
			preservesPitch: 'preservesPitch' in a,
			webkitPreservesPitch: 'webkitPreservesPitch' in a,
			mozPreservesPitch: 'mozPreservesPitch' in a,
			m4a: a.canPlayType('audio/mp4; codecs="mp4a.40.2"'),
			mp3: a.canPlayType('audio/mpeg'),
			opus: a.canPlayType('audio/ogg; codecs="opus"'),
			webmOpus: a.canPlayType('audio/webm; codecs="opus"')
		};
		try {
			stored = [...(await listFiles('shared')), ...(await listFiles('drive'))].filter(
				(f) => !f.type.startsWith('text/')
			);
		} catch (e) {
			error = String(e);
		}
	});
</script>

<h1>Slow-down quality</h1>

<div class="row">
	<input
		type="file"
		accept="audio/*,.m4a"
		onchange={(e) => {
			const f = e.currentTarget.files?.[0];
			if (f) use(f, f.name);
		}}
	/>
</div>
{#if stored.length}
	<div class="row">
		From OPFS:
		{#each stored as f (f.backend + f.dir + f.name)}
			<button onclick={async () => use(await getFile(f), `${f.dir}/${f.name}`)}>
				{f.dir}/{f.name.slice(0, 30)}
			</button>
		{/each}
	</div>
{/if}
{#if error}<p class="err">{error}</p>{/if}

{#if src}
	<p>{label}</p>
	<audio bind:this={audio} controls {src} {loop}></audio>
	<div class="row">
		{#each PRESETS as r (r)}
			<button aria-pressed={rate === r} onclick={() => setRate(r)}>{Math.round(r * 100)}%</button>
		{/each}
	</div>
	<div class="row">
		<button onclick={() => setRate(rate - 0.05)}>−5%</button>
		<b>{Math.round(rate * 100)}%</b>
		<button onclick={() => setRate(rate + 0.05)}>+5%</button>
		<label><input type="checkbox" bind:checked={preservesPitch} /> preservesPitch</label>
		<label><input type="checkbox" bind:checked={loop} /> loop</label>
	</div>
	<p>
		Listening test: compare 50/60/75% with preservesPitch on (time-stretched) and off (tape-style,
		pitch drops). Note warbling, smearing of ornaments/cuts, and any clicks at the loop point.
	</p>
{/if}

<pre>{JSON.stringify(support, null, 1)}</pre>
