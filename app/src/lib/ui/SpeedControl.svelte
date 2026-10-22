<!--
	The speed control (PLAN.md §6.5, §6.6): presets plus fine ±5% steps, easy to hit with a thumb.
	Used compact in the player bar, and large in Shuffle (M6).
-->
<script lang="ts">
	import { SPEED_MAX, SPEED_MIN, SPEED_PRESETS, formatRate, stepRate } from '#lib/audio/bounds.ts';

	let {
		rate,
		onchange,
		size = 'compact',
		label = 'Speed'
	}: {
		rate: number;
		onchange: (rate: number) => void;
		size?: 'compact' | 'large';
		label?: string;
	} = $props();
</script>

<div class="speed {size}" role="group" aria-label={label}>
	<div class="fine">
		<button
			type="button"
			class="btn-quiet step"
			aria-label="Slower, 5%"
			disabled={rate <= SPEED_MIN}
			onclick={() => onchange(stepRate(rate, -1))}>−</button
		>
		<output class="value" aria-live="polite" aria-label="Current speed">{formatRate(rate)}</output>
		<button
			type="button"
			class="btn-quiet step"
			aria-label="Faster, 5%"
			disabled={rate >= SPEED_MAX}
			onclick={() => onchange(stepRate(rate, 1))}>+</button
		>
	</div>
	<div class="presets">
		{#each SPEED_PRESETS as preset (preset)}
			<button
				type="button"
				class="preset"
				aria-pressed={Math.abs(rate - preset) < 0.001}
				aria-label="{formatRate(preset)} speed"
				onclick={() => onchange(preset)}>{formatRate(preset)}</button
			>
		{/each}
	</div>
</div>

<style>
	.speed {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}

	.fine {
		display: flex;
		align-items: center;
		gap: var(--space-1);
	}

	.step {
		min-width: var(--touch);
		padding: 0;
		font-size: 1.25rem;
	}

	.value {
		min-width: 3.25rem;
		text-align: center;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}

	.presets {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
	}

	.preset {
		min-width: var(--touch);
		padding: 0 var(--space-2);
		background: var(--color-surface);
		color: var(--color-text);
		border: 1px solid var(--color-border);
		font-variant-numeric: tabular-nums;
	}

	.preset[aria-pressed='true'] {
		background: var(--color-accent);
		color: var(--color-on-accent);
		border-color: var(--color-accent);
	}

	.large {
		flex-direction: column;
		align-items: stretch;
		gap: var(--space-3);
	}

	.large .fine {
		justify-content: center;
		gap: var(--space-3);
	}

	.large .step {
		min-width: 3.5rem;
		min-height: 3.5rem;
		font-size: 1.75rem;
	}

	.large .value {
		min-width: 5rem;
		font-size: 1.75rem;
	}

	.large .presets {
		display: grid;
		grid-template-columns: repeat(5, 1fr);
	}

	.large .preset {
		min-height: 3.25rem;
		font-size: 1.0625rem;
	}
</style>
