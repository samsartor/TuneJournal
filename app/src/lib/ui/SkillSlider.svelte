<script lang="ts">
	import { SKILL_LABEL } from '#lib/domain/format.ts';
	import type { Skill } from '#lib/domain/types.ts';

	let {
		skill,
		onchange,
		id = 'skill'
	}: { skill?: Skill; onchange: (skill: Skill | null) => void; id?: string } = $props();

	// 0 stands for unrated, so the range stays keyboard-operable end to end.
	const value = $derived(skill ?? 0);
	const label = $derived(skill ? `${skill} · ${SKILL_LABEL[skill]}` : 'Unrated');

	function input(e: Event) {
		const n = Number((e.currentTarget as HTMLInputElement).value);
		onchange(n === 0 ? null : (n as Skill));
	}
</script>

<div class="skill">
	<div class="row">
		<label for={id}>Skill</label>
		<output for={id} class:muted={!skill}>{label}</output>
	</div>
	<div class="row">
		<input
			{id}
			type="range"
			min="0"
			max="5"
			step="1"
			{value}
			oninput={input}
			aria-valuetext={label}
			list="{id}-ticks"
		/>
		{#if skill}
			<button type="button" class="btn-quiet clear" onclick={() => onchange(null)}>
				Clear rating
			</button>
		{/if}
	</div>
	<datalist id="{id}-ticks">
		{#each [0, 1, 2, 3, 4, 5] as n (n)}<option value={n}></option>{/each}
	</datalist>
</div>

<style>
	.skill {
		display: grid;
		gap: var(--space-1);
	}

	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}

	label {
		font-weight: 600;
	}

	input {
		flex: 1;
		min-width: 0;
	}

	.clear {
		font-size: 0.875rem;
		flex: none;
	}
</style>
