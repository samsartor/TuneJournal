<!--
	The trim editor (PLAN.md §6.6): picks a {start, end} region of a recording without touching the
	source. With a blob it draws the waveform (wavesurfer.js + regions, loaded on demand) and
	previews with its own audio; without one (YouTube) it's a two-handle slider that previews
	through the global player. Reusable: M5's Split takes the same {start, end}.
-->
<script lang="ts" module>
	export interface TrimRange {
		start: number;
		end: number;
	}
</script>

<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { formatTime, parseTime } from '#lib/audio/bounds.ts';

	let {
		blob,
		duration: knownDuration,
		start: initialStart,
		end: initialEnd,
		currentTime,
		onpreview,
		onstoppreview,
		onsave,
		oncancel,
		saveLabel = 'Save trim'
	}: {
		/** File sources: the audio, for the waveform. Leave out for the slider (YouTube). */
		blob?: Blob;
		/** Media length in seconds; read from the blob when there is one. */
		duration?: number;
		start?: number;
		end?: number;
		/** Slider mode: the player's current time, for "Set start/end here". */
		currentTime?: number;
		/** Slider mode: preview the region (looped) through the player. */
		onpreview?: (range: TrimRange) => void;
		onstoppreview?: () => void;
		/** The chosen region, plus the media's length (so callers can tell a whole-file region). */
		onsave: (range: TrimRange, duration: number) => void;
		oncancel?: () => void;
		saveLabel?: string;
	} = $props();

	const uid = $props.id();
	const MIN_LENGTH = 0.2;

	// svelte-ignore state_referenced_locally
	let duration = $state(knownDuration ?? 0);
	// svelte-ignore state_referenced_locally
	let start = $state(initialStart ?? 0);
	// svelte-ignore state_referenced_locally
	let end = $state(initialEnd ?? knownDuration ?? 0);
	let previewing = $state(false);
	// svelte-ignore state_referenced_locally
	let loading = $state(!!blob);
	let error = $state('');
	let waveEl = $state<HTMLElement>();

	$effect(() => {
		// The slider's media length can arrive after the editor opens.
		if (!blob && knownDuration && !duration) {
			duration = knownDuration;
			if (!end) end = initialEnd ?? knownDuration;
		}
	});

	/* eslint-disable @typescript-eslint/no-explicit-any */
	let ws: any;
	let region: any;
	/* eslint-enable @typescript-eslint/no-explicit-any */
	let objectUrl: string | undefined;

	const cssVar = (name: string, fallback: string) =>
		getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

	onMount(async () => {
		if (!blob) return;
		try {
			const [{ default: WaveSurfer }, { default: RegionsPlugin }] = await Promise.all([
				import('wavesurfer.js'),
				import('wavesurfer.js/plugins/regions')
			]);
			const regions = RegionsPlugin.create();
			objectUrl = URL.createObjectURL(blob);
			const accent = cssVar('--color-accent', '#2f6f5e');
			ws = WaveSurfer.create({
				container: waveEl!,
				height: 96,
				waveColor: cssVar('--color-muted', '#5f6b66'),
				progressColor: accent,
				cursorColor: accent,
				normalize: true,
				dragToSeek: false,
				plugins: [regions]
			});
			ws.on('decode', (d: number) => {
				duration = d;
				if (!end || end > d) end = initialEnd && initialEnd <= d ? initialEnd : d;
				if (start >= end) start = 0;
				region = regions.addRegion({
					start,
					end,
					color: `color-mix(in srgb, ${accent} 22%, transparent)`,
					drag: true,
					resize: true,
					minLength: MIN_LENGTH
				});
				loading = false;
			});
			regions.on('region-updated', (r: { start: number; end: number }) => {
				start = round(r.start);
				end = round(r.end);
			});
			// Drawing a new selection replaces the old region.
			regions.enableDragSelection({ color: `color-mix(in srgb, ${accent} 22%, transparent)` });
			regions.on('region-created', (r: { remove(): void; start: number; end: number }) => {
				if (region && r !== region) {
					region.remove();
					region = r;
					start = round(r.start);
					end = round(r.end);
				}
			});
			// Loop the preview within the region.
			ws.on('timeupdate', (t: number) => {
				if (previewing && t >= end - 0.03) ws.setTime(start);
			});
			ws.on('pause', () => (previewing = false));
			await ws.load(objectUrl);
		} catch (e) {
			console.warn('Waveform failed', e);
			error = 'Couldn’t draw the waveform. You can still type the times.';
			loading = false;
		}
	});

	onDestroy(() => {
		ws?.destroy();
		if (objectUrl) URL.revokeObjectURL(objectUrl);
		if (previewing && !blob) onstoppreview?.();
	});

	function round(t: number) {
		return Math.round(t * 1000) / 1000;
	}

	function setRange(nextStart: number, nextEnd: number) {
		const max = duration || Infinity;
		nextStart = Math.max(0, Math.min(nextStart, max));
		nextEnd = Math.max(0, Math.min(nextEnd, max));
		if (nextEnd - nextStart < MIN_LENGTH) return false;
		start = round(nextStart);
		end = round(nextEnd);
		region?.setOptions({ start, end });
		if (previewing) {
			if (blob) ws?.setTime(start);
			else onpreview?.({ start, end });
		}
		return true;
	}

	function onTimeInput(which: 'start' | 'end', e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const t = parseTime(input.value);
		const ok = t !== undefined && (which === 'start' ? setRange(t, end) : setRange(start, t));
		if (!ok) input.value = formatTime(which === 'start' ? start : end, 1);
	}

	function togglePreview() {
		if (previewing) {
			previewing = false;
			if (blob) ws?.pause();
			else onstoppreview?.();
			return;
		}
		previewing = true;
		if (blob) {
			ws?.setTime(start);
			ws?.play();
		} else onpreview?.({ start, end });
	}

	function reset() {
		setRange(0, duration);
	}

	function save() {
		if (previewing) togglePreview();
		onsave({ start, end }, duration);
	}
</script>

<div class="trim">
	{#if blob}
		<div class="wave" bind:this={waveEl} aria-hidden="true"></div>
		{#if loading}<p class="muted">Drawing the waveform…</p>{/if}
		<p class="muted small">Drag the shaded region, or its edges, to choose the part to keep.</p>
	{:else}
		<div class="slider" role="group" aria-label="Region">
			<input
				type="range"
				aria-label="Start"
				aria-valuetext={formatTime(start, 1)}
				min="0"
				max={duration || 1}
				step="0.1"
				value={start}
				disabled={!duration}
				oninput={(e) => {
					const t = Number(e.currentTarget.value);
					if (!setRange(t, end)) e.currentTarget.value = String(start);
				}}
			/>
			<input
				type="range"
				aria-label="End"
				aria-valuetext={formatTime(end, 1)}
				min="0"
				max={duration || 1}
				step="0.1"
				value={end}
				disabled={!duration}
				oninput={(e) => {
					const t = Number(e.currentTarget.value);
					if (!setRange(start, t)) e.currentTarget.value = String(end);
				}}
			/>
		</div>
		{#if currentTime !== undefined}
			<div class="here">
				<button
					type="button"
					class="btn-quiet"
					disabled={!duration}
					onclick={() => setRange(currentTime, end)}
					>Set start here ({formatTime(currentTime)})</button
				>
				<button
					type="button"
					class="btn-quiet"
					disabled={!duration}
					onclick={() => setRange(start, currentTime)}>Set end here</button
				>
			</div>
		{/if}
	{/if}

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
			aria-pressed={previewing}
			disabled={loading || !duration}
			onclick={togglePreview}>{previewing ? 'Stop preview' : 'Preview (loop)'}</button
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

	.wave {
		min-height: 96px;
		border: 1px solid var(--color-border);
		border-radius: calc(var(--radius) * 0.75);
		background: var(--color-surface);
		overflow: hidden;
	}

	.slider {
		display: grid;
		gap: var(--space-1);
	}

	.slider input {
		width: 100%;
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
