<script lang="ts">
	import { SKILL_LABEL } from '#lib/domain/format.ts';
	import type { Skill } from '#lib/domain/types.ts';

	let {
		skill,
		onchange,
		id = 'skill',
		inherited
	}: {
		/** The piece's own skill. */
		skill?: Skill;
		onchange: (skill: Skill | null) => void;
		id?: string;
		/** A Part's Tune's skill, used while the Part has none of its own (§5). */
		inherited?: { skill?: Skill; from: string };
	} = $props();

	const shown = $derived(skill ?? inherited?.skill);
	const isInherited = $derived(skill === undefined && inherited?.skill !== undefined);
	// 0 stands for unrated, so the range stays keyboard-operable end to end.
	const value = $derived(shown ?? 0);
	const label = $derived(shown ? `${shown} · ${SKILL_LABEL[shown]}` : 'Unrated');
	const valueText = $derived(isInherited ? `${label}, from ${inherited!.from}` : label);

	function input(e: Event) {
		const n = Number((e.currentTarget as HTMLInputElement).value);
		onchange(n === 0 ? null : (n as Skill));
	}
</script>

<div class="skill">
	<!-- The value and its actions share the header row, so the slider's width never depends on the
	value: nothing appears beside it mid-drag. -->
	<div class="head">
		<label for={id}>Skill</label>
		<output for={id} class:muted={!skill}
			>{label}{#if isInherited}<span class="from">{` · from ${inherited!.from}`}</span>{/if}</output
		>
		{#if skill && inherited}
			<button type="button" class="btn-quiet clear" onclick={() => onchange(null)}>
				Use {inherited.from}’s
			</button>
		{:else if skill}
			<button type="button" class="btn-quiet clear" onclick={() => onchange(null)}>
				Clear rating
			</button>
		{/if}
	</div>
	<input
		{id}
		type="range"
		min="0"
		max="5"
		step="1"
		{value}
		oninput={input}
		aria-valuetext={valueText}
		class:inherited={isInherited}
		list="{id}-ticks"
	/>
	<datalist id="{id}-ticks">
		{#each [0, 1, 2, 3, 4, 5] as n (n)}<option value={n}></option>{/each}
	</datalist>
</div>

<style>
	.skill {
		display: grid;
		gap: var(--space-1);
	}

	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1) var(--space-2);
		/* As tall as the button, so the row doesn't grow when it appears. */
		min-height: var(--touch);
	}

	output {
		flex: 1;
		min-width: 0;
	}

	label {
		font-weight: 600;
	}

	input {
		width: 100%;
		margin: 0;
	}

	input.inherited {
		opacity: 0.55;
	}

	.from {
		font-style: italic;
	}

	.clear {
		flex: none;
		font-size: 0.875rem;
		margin-left: auto;
	}
</style>
