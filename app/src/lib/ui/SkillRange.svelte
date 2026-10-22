<!--
	A two-handle 1–5 skill range (PLAN.md §6.5): two native range inputs on one track, so each
	handle stays keyboard-operable and labelled. The handles can meet but not cross.
-->
<script lang="ts">
	import { SKILL_LABEL } from '#lib/domain/format.ts';
	import type { Skill } from '#lib/domain/types.ts';

	let {
		min,
		max,
		onchange,
		id = 'skill-range',
		label = 'Skill range'
	}: {
		min: Skill;
		max: Skill;
		onchange: (range: { skillMin: Skill; skillMax: Skill }) => void;
		id?: string;
		label?: string;
	} = $props();

	const text = (n: Skill) => `${n} · ${SKILL_LABEL[n]}`;
	const pct = (n: number) => ((n - 1) / 4) * 100;

	function setMin(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const n = Math.min(Number(input.value), max) as Skill;
		input.value = String(n);
		if (n !== min) onchange({ skillMin: n, skillMax: max });
	}

	function setMax(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const n = Math.max(Number(input.value), min) as Skill;
		input.value = String(n);
		if (n !== max) onchange({ skillMin: min, skillMax: n });
	}
</script>

<div class="range" role="group" aria-labelledby="{id}-label">
	<div class="row">
		<span class="label" id="{id}-label">{label}</span>
		<output class="value" aria-live="polite"
			>{min === max ? text(min) : `${text(min)} – ${text(max)}`}</output
		>
	</div>
	<div class="track" style:--lo="{pct(min)}%" style:--hi="{pct(max)}%">
		<div class="fill" aria-hidden="true"></div>
		<input
			type="range"
			min="1"
			max="5"
			step="1"
			value={min}
			class:raised={min === max && min >= 3}
			aria-label="Minimum skill"
			aria-valuetext={text(min)}
			oninput={setMin}
		/>
		<input
			type="range"
			min="1"
			max="5"
			step="1"
			value={max}
			aria-label="Maximum skill"
			aria-valuetext={text(max)}
			oninput={setMax}
		/>
	</div>
	<div class="ticks" aria-hidden="true">
		{#each [1, 2, 3, 4, 5] as n (n)}<span>{n}</span>{/each}
	</div>
</div>

<style>
	.range {
		display: grid;
		gap: var(--space-1);
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-2);
	}

	.label {
		font-weight: 600;
	}

	.value {
		color: var(--color-muted);
		font-size: 0.9375rem;
	}

	.track {
		position: relative;
		height: var(--touch);
		/* Inset by half a thumb, so the fill lines up with the thumbs' centres. */
		--thumb: 1.375rem;
	}

	.track::before,
	.fill {
		content: '';
		position: absolute;
		top: 50%;
		height: 0.375rem;
		border-radius: 999px;
		transform: translateY(-50%);
	}

	.track::before {
		left: calc(var(--thumb) / 2);
		right: calc(var(--thumb) / 2);
		background: var(--color-border);
	}

	.fill {
		left: calc(var(--thumb) / 2 + (100% - var(--thumb)) * var(--lo) / 100%);
		width: calc((100% - var(--thumb)) * (var(--hi) - var(--lo)) / 100%);
		background: var(--color-accent);
	}

	/* Both inputs span the track; only their thumbs take pointer events. */
	input {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		margin: 0;
		appearance: none;
		-webkit-appearance: none;
		background: transparent;
		pointer-events: none;
	}

	/* When the handles meet near the top, the minimum's must be the one on top to be draggable. */
	input.raised {
		z-index: 1;
	}

	input::-webkit-slider-runnable-track {
		background: transparent;
		border: none;
	}

	input::-moz-range-track {
		background: transparent;
		border: none;
	}

	input::-webkit-slider-thumb {
		-webkit-appearance: none;
		appearance: none;
		width: var(--thumb);
		height: var(--thumb);
		border-radius: 50%;
		background: var(--color-accent);
		border: 3px solid var(--color-surface);
		box-shadow: 0 0 0 1px var(--color-accent);
		cursor: pointer;
		pointer-events: auto;
	}

	input::-moz-range-thumb {
		width: var(--thumb);
		height: var(--thumb);
		border-radius: 50%;
		background: var(--color-accent);
		border: 3px solid var(--color-surface);
		box-shadow: 0 0 0 1px var(--color-accent);
		cursor: pointer;
		pointer-events: auto;
	}

	input:focus-visible {
		outline: none;
	}

	input:focus-visible::-webkit-slider-thumb {
		outline: 2px solid var(--color-accent);
		outline-offset: 2px;
	}

	input:focus-visible::-moz-range-thumb {
		outline: 2px solid var(--color-accent);
		outline-offset: 2px;
	}

	.ticks {
		display: flex;
		justify-content: space-between;
		padding: 0 calc(1.375rem / 2 - 0.3rem);
		color: var(--color-muted);
		font-size: 0.8125rem;
		font-variant-numeric: tabular-nums;
	}
</style>
