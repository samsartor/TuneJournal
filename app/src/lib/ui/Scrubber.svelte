<!--
	A seek bar with the elapsed and total time (PLAN.md §6.6): the player bar's, Shuffle's (large),
	and the preview bar's in the thesession pickers. A range input, so dragging, tapping and the arrow keys all
	work. Times are whatever the player reports (tune seconds at 100% for a synthesized tune).
-->
<script lang="ts">
	import { formatTime } from '#lib/audio/bounds.ts';

	let {
		time,
		start = 0,
		end,
		disabled = false,
		label = 'Position',
		size = 'compact',
		onseek
	}: {
		time: number;
		start?: number;
		end: number;
		disabled?: boolean;
		label?: string;
		size?: 'compact' | 'large';
		onseek: (time: number) => void;
	} = $props();

	const max = $derived(Math.max(end, start + 0.1));
</script>

<div class="scrub {size}">
	<span class="time" data-testid="scrub-time">{formatTime(time)}</span>
	<input
		type="range"
		aria-label={label}
		aria-valuetext="{formatTime(time)} of {formatTime(max)}"
		min={start}
		{max}
		step="0.1"
		value={Math.min(Math.max(time, start), max)}
		{disabled}
		oninput={(e) => onseek(Number(e.currentTarget.value))}
	/>
	<span class="time" data-testid="scrub-end">{formatTime(max)}</span>
</div>

<style>
	.scrub {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		min-width: 0;
	}

	input {
		flex: 1;
		min-width: 0;
		min-height: 2rem;
	}

	.time {
		font-size: 0.75rem;
		color: var(--color-muted);
		font-variant-numeric: tabular-nums;
	}

	.large {
		gap: var(--space-2);
	}

	.large input {
		min-height: 0;
	}

	.large .time {
		font-size: 0.875rem;
	}
</style>
