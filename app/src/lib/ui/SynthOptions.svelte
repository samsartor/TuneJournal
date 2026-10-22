<!--
	Options for synthesized playback of thesession settings (PLAN.md §6.6): instrument, times
	through the tune and chord accompaniment. Device-local, like the speed; changing one re-renders
	whatever synthesized tune is loaded in the player, in place. Shown in Settings and in a
	thesession recording's Edit dialog.
-->
<script lang="ts">
	import { INSTRUMENTS, INSTRUMENT_IDS, MAX_TIMES_THROUGH } from '#lib/domain/synth.ts';
	import type { InstrumentId } from '#lib/domain/synth.ts';
	import { synth } from '#lib/store/synth.svelte.ts';

	const uid = $props.id();
	const times = Array.from({ length: MAX_TIMES_THROUGH }, (_, i) => i + 1);
</script>

<div class="synth-options" role="group" aria-label="Synthesized playback">
	<div class="field">
		<label for="{uid}-instrument">Instrument</label>
		<select
			id="{uid}-instrument"
			value={synth.options.instrument}
			onchange={(e) => synth.setOptions({ instrument: e.currentTarget.value as InstrumentId })}
		>
			{#each INSTRUMENT_IDS as id (id)}
				<option value={id}>{INSTRUMENTS[id].label}</option>
			{/each}
		</select>
	</div>
	<div class="field">
		<label for="{uid}-times">Times through</label>
		<select
			id="{uid}-times"
			value={String(synth.options.timesThrough)}
			onchange={(e) => synth.setOptions({ timesThrough: Number(e.currentTarget.value) })}
		>
			{#each times as n (n)}
				<option value={String(n)}>{n}×</option>
			{/each}
		</select>
	</div>
	<label class="check">
		<input
			type="checkbox"
			checked={synth.options.chords}
			onchange={(e) => synth.setOptions({ chords: e.currentTarget.checked })}
		/>
		Chord accompaniment
	</label>
</div>

<style>
	.synth-options {
		display: flex;
		flex-wrap: wrap;
		align-items: end;
		gap: var(--space-2) var(--space-3);
	}

	.field {
		display: grid;
		gap: var(--space-1);
	}

	label {
		font-weight: 600;
		font-size: 0.875rem;
	}

	.check {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		min-height: var(--touch);
		font-weight: 400;
	}
</style>
