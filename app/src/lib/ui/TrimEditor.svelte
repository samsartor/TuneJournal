<!--
	The trim editor (PLAN.md §6.6): picks a {start, end} region of a recording without touching the
	source. It has its own transport, driving the global player (the caller loads the clip there
	first; the mini-player bar sits behind the dialog): play/pause over the whole recording, a
	playhead you can scrub on the waveform (a plain timeline for YouTube), two flags for the start
	and end, "set start/end at playhead", a looped preview of the region, and typed times. The
	waveform is drawn from the file's own samples. Reused by M5's Split.
-->
<script lang="ts" module>
	export interface TrimRange {
		start: number;
		end: number;
	}

	/** Columns of the drawn waveform: enough for a wide dialog, cheap to compute. */
	const PEAK_COLUMNS = 1200;

	/** Peak amplitude (0–1) per column across all channels, normalized to the loudest. */
	export async function wavePeaks(blob: Blob): Promise<{ peaks: Float32Array; duration: number }> {
		const context = new OfflineAudioContext(1, 1, 44100);
		const audio = await context.decodeAudioData(await blob.arrayBuffer());
		const peaks = new Float32Array(PEAK_COLUMNS);
		const per = Math.max(1, Math.floor(audio.length / PEAK_COLUMNS));
		for (let c = 0; c < audio.numberOfChannels; c++) {
			const data = audio.getChannelData(c);
			for (let col = 0; col < PEAK_COLUMNS; col++) {
				let max = peaks[col];
				const end = Math.min(data.length, (col + 1) * per);
				for (let i = col * per; i < end; i++) {
					const v = Math.abs(data[i]);
					if (v > max) max = v;
				}
				peaks[col] = max;
			}
		}
		let loudest = 0;
		for (const p of peaks) if (p > loudest) loudest = p;
		if (loudest > 0) for (let i = 0; i < peaks.length; i++) peaks[i] /= loudest;
		return { peaks, duration: audio.duration };
	}
</script>

<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { formatTime, parseTime } from '#lib/audio/bounds.ts';
	import { player } from '#lib/audio/player.svelte.ts';

	let {
		waveform,
		duration: knownDuration,
		start: initialStart,
		end: initialEnd,
		onsave,
		oncancel,
		saveLabel = 'Save trim'
	}: {
		/** File sources: the audio, to draw its waveform. Leave out for a plain timeline (YouTube). */
		waveform?: Blob;
		/** Media length in seconds, if known before the player or the waveform reports it. */
		duration?: number;
		start?: number;
		end?: number;
		/** The chosen region, plus the media's length (so callers can tell a whole-file region). */
		onsave: (range: TrimRange, duration: number) => void;
		oncancel?: () => void;
		saveLabel?: string;
	} = $props();

	const uid = $props.id();
	const MIN_LENGTH = 0.2;

	let decoded = $state<number>();
	let peaks = $state.raw<Float32Array>();
	// svelte-ignore state_referenced_locally
	let loading = $state(!!waveform);
	let error = $state('');
	const duration = $derived(decoded || player.duration || knownDuration || 0);

	// svelte-ignore state_referenced_locally
	let start = $state(initialStart ?? 0);
	// svelte-ignore state_referenced_locally
	let end = $state(initialEnd ?? knownDuration ?? 0);
	/** Looping the region (rather than playing the whole recording). */
	let looping = $state(false);
	const head = $derived(player.time);
	const playing = $derived(player.playing);

	let lane = $state<HTMLElement>();
	let canvas = $state<HTMLCanvasElement>();

	$effect(() => {
		// The media's length can arrive after the editor opens.
		if (duration && !end) end = initialEnd && initialEnd <= duration ? initialEnd : duration;
		if (duration && end > duration) end = duration;
		if (duration && start >= end) start = 0;
	});

	onMount(() => {
		// Play the whole recording, so the playhead can go outside the current trim.
		player.editTrim();
		if (!waveform) return;
		wavePeaks(waveform)
			.then((w) => {
				peaks = w.peaks;
				decoded = w.duration;
			})
			.catch((e) => {
				console.warn('Waveform failed', e);
				error = 'Couldn’t draw the waveform. You can still use the timeline or type the times.';
			})
			.finally(() => (loading = false));
	});

	onDestroy(() => {
		if (player.playing) player.pause();
		player.endPreview();
	});

	// Draw the waveform to fit the lane, crisp on high-density screens.
	$effect(() => {
		const el = canvas;
		const data = peaks;
		if (!el || !data) return;
		const draw = () => {
			const ratio = devicePixelRatio || 1;
			const width = Math.max(1, Math.round(el.clientWidth * ratio));
			const height = Math.max(1, Math.round(el.clientHeight * ratio));
			el.width = width;
			el.height = height;
			const g = el.getContext('2d');
			if (!g) return;
			g.clearRect(0, 0, width, height);
			g.fillStyle =
				getComputedStyle(el).getPropertyValue('--wave-color').trim() || 'rgb(95 107 102)';
			const mid = height / 2;
			for (let x = 0; x < width; x++) {
				const from = Math.floor((x / width) * data.length);
				const to = Math.max(from + 1, Math.floor(((x + 1) / width) * data.length));
				let peak = 0;
				for (let i = from; i < to; i++) if (data[i] > peak) peak = data[i];
				const h = Math.max(1, peak * (height - 4));
				g.fillRect(x, mid - h / 2, 1, h);
			}
		};
		draw();
		const observer = new ResizeObserver(draw);
		observer.observe(el);
		return () => observer.disconnect();
	});

	function round(t: number) {
		return Math.round(t * 1000) / 1000;
	}

	const pct = (t: number) => (duration ? Math.min(100, Math.max(0, (t / duration) * 100)) : 0);

	function setRange(nextStart: number, nextEnd: number) {
		const max = duration || Infinity;
		nextStart = Math.max(0, Math.min(nextStart, max));
		nextEnd = Math.max(0, Math.min(nextEnd, max));
		if (nextEnd - nextStart < MIN_LENGTH) return false;
		start = round(nextStart);
		end = round(nextEnd);
		if (looping) void player.preview(start, end, { restart: false });
		return true;
	}

	function onTimeInput(which: 'start' | 'end', e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const t = parseTime(input.value);
		const ok = t !== undefined && (which === 'start' ? setRange(t, end) : setRange(start, t));
		if (!ok) input.value = formatTime(which === 'start' ? start : end, 1);
	}

	function onFlag(which: 'start' | 'end', e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const t = Number(input.value);
		const ok = which === 'start' ? setRange(t, end) : setRange(start, t);
		if (!ok) input.value = String(which === 'start' ? start : end);
	}

	function seek(t: number) {
		const time = Math.max(0, Math.min(t, duration || t));
		// Leaving the region ends the loop, so the playhead can go there.
		if (looping && (time < start || time > end)) stopLoop();
		player.seek(time);
	}

	// Scrubbing on the waveform: press, then drag.
	let scrubbing = false;

	function timeAt(e: PointerEvent) {
		const rect = lane!.getBoundingClientRect();
		return ((e.clientX - rect.left) / rect.width) * duration;
	}

	function scrubStart(e: PointerEvent) {
		if (!duration || !lane || e.button !== 0) return;
		scrubbing = true;
		lane.setPointerCapture(e.pointerId);
		seek(timeAt(e));
		e.preventDefault();
	}

	function scrubMove(e: PointerEvent) {
		if (scrubbing) seek(timeAt(e));
	}

	function scrubEnd() {
		scrubbing = false;
	}

	function togglePlay() {
		player.toggle();
	}

	function stopLoop() {
		looping = false;
		player.editTrim();
	}

	function togglePreview() {
		if (looping) {
			player.pause();
			stopLoop();
			return;
		}
		looping = true;
		void player.preview(start, end);
	}

	function reset() {
		setRange(0, duration);
	}

	function save() {
		if (looping) togglePreview();
		else if (player.playing) player.pause();
		onsave({ start, end }, duration);
	}
</script>

<div class="trim">
	<div
		class="timeline"
		class:wave={!!waveform}
		style:--lo={pct(start)}
		style:--hi={pct(end)}
		style:--head={pct(head)}
	>
		<!-- Pointer-only: the Playhead slider below is the keyboard path. -->
		<div
			class="lane"
			bind:this={lane}
			aria-hidden="true"
			data-testid="trim-lane"
			onpointerdown={scrubStart}
			onpointermove={scrubMove}
			onpointerup={scrubEnd}
			onpointercancel={scrubEnd}
		>
			{#if waveform && peaks}
				<canvas bind:this={canvas}></canvas>
			{:else}
				<div class="bar"></div>
			{/if}
			<div class="region"></div>
			<div class="playhead"></div>
		</div>
		<input
			class="flag"
			class:raised={pct(start) > 50}
			type="range"
			aria-label="Start flag"
			aria-valuetext={formatTime(start, 1)}
			min="0"
			max={duration || 1}
			step="0.01"
			value={start}
			disabled={!duration}
			oninput={(e) => onFlag('start', e)}
		/>
		<input
			class="flag"
			type="range"
			aria-label="End flag"
			aria-valuetext={formatTime(end, 1)}
			min="0"
			max={duration || 1}
			step="0.01"
			value={end}
			disabled={!duration}
			oninput={(e) => onFlag('end', e)}
		/>
	</div>
	{#if loading}<p class="muted small">Drawing the waveform…</p>{/if}
	<p class="muted small">
		Drag the flags to choose the part to keep. Tap or drag on the {waveform
			? 'waveform'
			: 'timeline'}
		to move the playhead.
	</p>

	<div class="transport" role="group" aria-label="Playback">
		<button
			type="button"
			class="play"
			aria-label={playing ? 'Pause' : 'Play'}
			disabled={!duration || player.loading}
			onclick={togglePlay}>{playing ? '❚❚' : '▶'}</button
		>
		<span class="time" data-testid="trim-playhead">{formatTime(head, 1)}</span>
		<input
			class="position"
			type="range"
			aria-label="Playhead"
			aria-valuetext={formatTime(head, 1)}
			min="0"
			max={duration || 1}
			step="0.1"
			value={Math.min(head, duration || head)}
			disabled={!duration}
			oninput={(e) => seek(Number(e.currentTarget.value))}
		/>
		<span class="time muted">{formatTime(duration)}</span>
	</div>

	<div class="here">
		<button
			type="button"
			class="btn-quiet"
			disabled={!duration || head >= end - MIN_LENGTH}
			onclick={() => setRange(head, end)}>Set start at playhead</button
		>
		<button
			type="button"
			class="btn-quiet"
			disabled={!duration || head <= start + MIN_LENGTH}
			onclick={() => setRange(start, head)}>Set end at playhead</button
		>
	</div>

	{#if error}<p class="error" role="alert">{error}</p>{/if}

	<div class="times">
		<label for="{uid}-start">Start</label>
		<input
			id="{uid}-start"
			type="text"
			inputmode="decimal"
			autocomplete="off"
			value={formatTime(start, 1)}
			onchange={(e) => onTimeInput('start', e)}
		/>
		<label for="{uid}-end">End</label>
		<input
			id="{uid}-end"
			type="text"
			inputmode="decimal"
			autocomplete="off"
			value={formatTime(end, 1)}
			onchange={(e) => onTimeInput('end', e)}
		/>
		<span class="muted length">of {formatTime(duration)}</span>
	</div>

	<div class="actions">
		<button
			type="button"
			class="btn-quiet"
			aria-pressed={looping}
			disabled={loading || !duration}
			onclick={togglePreview}>{looping ? 'Stop preview' : 'Preview (loop)'}</button
		>
		<button type="button" class="btn-quiet" disabled={!duration} onclick={reset}>Reset</button>
		<span class="spacer"></span>
		{#if oncancel}<button type="button" class="btn-quiet" onclick={oncancel}>Cancel</button>{/if}
		<button type="button" disabled={loading || !duration} onclick={save}>{saveLabel}</button>
	</div>
</div>

<style>
	.trim {
		display: grid;
		gap: var(--space-3);
	}

	.timeline {
		/* The flags' width; the lane is inset by half of it, so flags line up with the times. */
		--flag: 22px;
		position: relative;
		height: 72px;
		touch-action: none;
		user-select: none;
	}

	.timeline.wave {
		height: 104px;
	}

	.lane {
		position: absolute;
		inset: 0 calc(var(--flag) / 2);
		border-radius: calc(var(--radius) * 0.5);
		background: var(--color-surface);
		box-shadow: 0 0 0 1px var(--color-border);
		cursor: pointer;
		overflow: hidden;
	}

	canvas {
		--wave-color: var(--color-muted);
		position: absolute;
		inset: 6px 0 6px;
		width: 100%;
		height: calc(100% - 12px);
	}

	.bar {
		position: absolute;
		left: 0;
		right: 0;
		top: 50%;
		height: 6px;
		transform: translateY(-50%);
		border-radius: 999px;
		background: var(--color-border);
	}

	.region {
		position: absolute;
		top: 0;
		bottom: 0;
		left: calc(var(--lo) * 1%);
		width: calc((var(--hi) - var(--lo)) * 1%);
		background: color-mix(in srgb, var(--color-accent) 22%, transparent);
		pointer-events: none;
	}

	.playhead {
		position: absolute;
		top: 0;
		bottom: 0;
		left: calc(var(--head) * 1%);
		width: 2px;
		margin-left: -1px;
		background: var(--color-danger);
		pointer-events: none;
	}

	/* Both flags span the timeline; only their handles take pointer events. */
	.flag {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		min-height: 0;
		margin: 0;
		appearance: none;
		-webkit-appearance: none;
		background: transparent;
		pointer-events: none;
	}

	.flag.raised {
		z-index: 1;
	}

	.flag::-webkit-slider-runnable-track {
		height: 100%;
		background: transparent;
		border: none;
	}

	.flag::-moz-range-track {
		height: 100%;
		background: transparent;
		border: none;
	}

	/* A pole the height of the timeline with a flag at the top. */
	.flag::-webkit-slider-thumb {
		-webkit-appearance: none;
		appearance: none;
		width: var(--flag);
		height: 100%;
		border: none;
		background:
			linear-gradient(var(--color-accent), var(--color-accent)) top / 100% 18px no-repeat,
			linear-gradient(
				90deg,
				transparent calc(50% - 2px),
				var(--color-accent) calc(50% - 2px) calc(50% + 2px),
				transparent calc(50% + 2px)
			);
		border-radius: 4px 4px 0 0;
		cursor: ew-resize;
		pointer-events: auto;
	}

	.flag::-moz-range-thumb {
		width: var(--flag);
		height: 100%;
		border: none;
		border-radius: 4px 4px 0 0;
		background:
			linear-gradient(var(--color-accent), var(--color-accent)) top / 100% 18px no-repeat,
			linear-gradient(
				90deg,
				transparent calc(50% - 2px),
				var(--color-accent) calc(50% - 2px) calc(50% + 2px),
				transparent calc(50% + 2px)
			);
		cursor: ew-resize;
		pointer-events: auto;
	}

	.flag:focus-visible {
		outline: none;
	}

	.flag:focus-visible::-webkit-slider-thumb {
		outline: 2px solid var(--color-text);
		outline-offset: 1px;
	}

	.flag:focus-visible::-moz-range-thumb {
		outline: 2px solid var(--color-text);
		outline-offset: 1px;
	}

	.transport {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.play {
		flex: none;
		width: var(--touch);
		padding: 0;
		border-radius: 50%;
	}

	.position {
		flex: 1;
		min-width: 0;
	}

	.time {
		flex: none;
		font-size: 0.875rem;
		font-variant-numeric: tabular-nums;
	}

	.here,
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.spacer {
		flex: 1;
	}

	.times {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}

	.times label {
		font-weight: 600;
	}

	.times input {
		width: 6.5rem;
		font-variant-numeric: tabular-nums;
	}

	.small,
	.length {
		margin: 0;
		font-size: 0.875rem;
	}

	.error {
		margin: 0;
		color: var(--color-danger);
	}

	p {
		margin: 0;
	}
</style>
