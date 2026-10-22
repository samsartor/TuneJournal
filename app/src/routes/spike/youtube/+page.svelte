<script lang="ts">
	import { onDestroy, onMount } from 'svelte';

	/* eslint-disable @typescript-eslint/no-explicit-any */
	type YTPlayer = any;
	const w = globalThis as any;
	/* eslint-enable @typescript-eslint/no-explicit-any */

	let url = $state('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
	let start = $state(10);
	let end = $state(20);
	let loop = $state(true);
	let rate = $state(1);
	let player: YTPlayer;
	let ready = $state(false);
	let available = $state<number[]>([]);
	let rateProbe = $state<string[]>([]);
	let actualRate = $state<number>();
	let time = $state(0);
	let loops = $state(0);
	let oembed = $state<string>();
	let error = $state('');
	let timer: ReturnType<typeof setInterval> | undefined;

	function videoId(input: string): string | undefined {
		try {
			const u = new URL(input.trim());
			if (u.hostname === 'youtu.be') return u.pathname.slice(1) || undefined;
			if (u.searchParams.get('v')) return u.searchParams.get('v') ?? undefined;
			const m = /^\/(?:shorts|embed|live)\/([\w-]{11})/.exec(u.pathname);
			return m?.[1];
		} catch {
			return /^[\w-]{11}$/.test(input.trim()) ? input.trim() : undefined;
		}
	}

	function loadApi(): Promise<void> {
		if (w.YT?.Player) return Promise.resolve();
		return new Promise((resolve) => {
			w.onYouTubeIframeAPIReady = () => resolve();
			const s = document.createElement('script');
			s.src = 'https://www.youtube.com/iframe_api';
			document.head.append(s);
		});
	}

	async function load() {
		error = '';
		const id = videoId(url);
		if (!id) return (error = 'Could not find a video id in that URL');
		const t = Number(new URL(url, location.href).searchParams.get('t')?.replace(/s$/, ''));
		if (Number.isFinite(t) && t > 0) start = t;
		fetchOembed();
		await loadApi();
		if (player) {
			player.loadVideoById({ videoId: id, startSeconds: start, endSeconds: end });
			return;
		}
		// The API replaces the element with its iframe, so address it by id inside a wrapper.
		player = new w.YT.Player('yt-player', {
			videoId: id,
			playerVars: { start: Math.floor(start), end: Math.ceil(end), playsinline: 1, rel: 0 },
			events: {
				onReady: () => {
					ready = true;
					available = player.getAvailablePlaybackRates();
				},
				onStateChange: (e: { data: number }) => {
					if (e.data === w.YT.PlayerState.PLAYING) {
						available = player.getAvailablePlaybackRates();
						player.setPlaybackRate(rate);
					}
					if (e.data === w.YT.PlayerState.ENDED && loop) restart();
				},
				onPlaybackRateChange: (e: { data: number }) => (actualRate = e.data),
				onError: (e: { data: number }) => (error = `Player error ${e.data}`)
			}
		});
		clearInterval(timer);
		timer = setInterval(() => {
			if (!player?.getCurrentTime) return;
			time = player.getCurrentTime();
			// `end` only applies to the first play; enforce it ourselves for loops and seeks.
			if (loop && time >= end && player.getPlayerState() === w.YT.PlayerState.PLAYING) restart();
		}, 100);
	}

	// getCurrentTime() lags a seek, so ignore the end check briefly after restarting.
	let restartedAt = 0;
	function restart() {
		if (performance.now() - restartedAt < 500) return;
		restartedAt = performance.now();
		loops++;
		player.seekTo(start, true);
		player.playVideo();
	}

	function setRate(r: number) {
		rate = Math.round(r * 100) / 100;
		player?.setPlaybackRate(rate);
		setTimeout(() => (actualRate = player?.getPlaybackRate()), 300);
	}

	// Ask for each 0.05 step and record what the player actually uses.
	async function probeRates() {
		rateProbe = [];
		try {
			for (let r = 0.5; r <= 1.0001; r += 0.05) {
				const want = Math.round(r * 100) / 100;
				player.setPlaybackRate(want);
				await new Promise((res) => setTimeout(res, 250));
				rateProbe.push(`${want} → ${player.getPlaybackRate()}`);
			}
			player.setPlaybackRate(rate);
		} catch (e) {
			rateProbe.push(`error: ${e}`);
		}
	}

	async function fetchOembed() {
		oembed = 'loading…';
		for (const endpoint of [
			`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`,
			`https://noembed.com/embed?url=${encodeURIComponent(url)}`
		]) {
			try {
				const j = await (await fetch(endpoint)).json();
				oembed = `${new URL(endpoint).host}: "${j.title}" by ${j.author_name}, thumb ${j.thumbnail_url}`;
				return;
			} catch (e) {
				oembed = `${new URL(endpoint).host} failed: ${e}`;
			}
		}
	}

	onMount(() => {
		if (new URLSearchParams(location.search).has('auto')) load();
	});
	onDestroy(() => {
		clearInterval(timer);
		player?.destroy();
	});
</script>

<h1>YouTube</h1>

<div class="row">
	<input bind:value={url} size="50" />
	<button onclick={load}>Load</button>
</div>
<div class="row">
	<label
		>start <input type="number" bind:value={start} min="0" step="0.5" style="width:5rem" /></label
	>
	<label>end <input type="number" bind:value={end} min="0" step="0.5" style="width:5rem" /></label>
	<label><input type="checkbox" bind:checked={loop} /> loop</label>
</div>
{#if error}<p class="err">{error}</p>{/if}

<div><div id="yt-player"></div></div>

{#if ready}
	<div class="row">
		<button onclick={() => player.playVideo()}>Play</button>
		<button onclick={() => player.pauseVideo()}>Pause</button>
		<button onclick={restart}>⟲ start</button>
		<span>t={time.toFixed(1)}s loops={loops}</span>
	</div>
	<div class="row">
		{#each [0.5, 0.6, 0.75, 0.9, 1] as r (r)}
			<button onclick={() => setRate(r)}>{Math.round(r * 100)}%</button>
		{/each}
		<button onclick={() => setRate(rate - 0.05)}>−5%</button>
		<button onclick={() => setRate(rate + 0.05)}>+5%</button>
	</div>
	<p>
		requested <b>{rate}</b>, player reports <b data-testid="actual-rate">{actualRate ?? '?'}</b>
	</p>
	<p>getAvailablePlaybackRates: <code data-testid="rates">{JSON.stringify(available)}</code></p>
	<div class="row"><button onclick={probeRates}>Probe 0.50…1.00 in 0.05 steps</button></div>
	{#if rateProbe.length}<pre data-testid="probe">{rateProbe.join('\n')}</pre>{/if}
{/if}

<p>oEmbed (fetched from this page): <code data-testid="oembed">{oembed ?? '—'}</code></p>
