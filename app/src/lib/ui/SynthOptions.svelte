<!--
	One playback profile's settings for synthesized thesession settings (PLAN.md §6.6, §14 "Tag
	playback profiles"): instrument, times through the tune, chord accompaniment, and the feel (lilt,
	accent and attack on the strong quavers). Sliders report once they settle; the caller writes the
	change to the library, which re-renders whatever synthesized tune is loaded, in place.
-->
<script lang="ts">
	import { onDestroy } from 'svelte';
	import {
		HUMANIZE_OFF,
		LILT_NOTCHES,
		formatLilt,
		liltNotch,
		type Humanize
	} from '#lib/domain/humanize.ts';
	import { INSTRUMENTS, INSTRUMENT_IDS, MAX_TIMES_THROUGH } from '#lib/domain/synth.ts';
	import type { PlaybackProfileSettings } from '#lib/domain/types.ts';

	let {
		settings,
		seed,
		label,
		onchange
	}: {
		settings: PlaybackProfileSettings;
		/** The feel "Default" goes back to: this profile's seeded one. */
		seed: Humanize;
		/** The group's accessible name, e.g. "Reel profile". */
		label: string;
		onchange: (patch: Partial<PlaybackProfileSettings>) => void;
	} = $props();

	const uid = $props.id();
	const times = Array.from({ length: MAX_TIMES_THROUGH }, (_, i) => i + 1);

	/** Waits for a slider to settle before re-rendering what's loaded. */
	const SETTLE_MS = 400;

	type Amount = 'lilt' | 'accent' | 'attack';
	const signed = (v: number) => (v > 0 ? `+${v}` : String(v));
	const AMOUNTS: {
		field: Amount;
		label: string;
		hint: string;
		text: (v: number) => string;
		/** The slider's position for a value, and back. */
		toSlider: (v: number) => number;
		fromSlider: (p: number) => number;
		min: number;
		max: number;
		step: number;
	}[] = [
		{
			field: 'lilt',
			label: 'Lilt',
			hint: 'The strong quaver against each of the others: 1.5:1 makes it half as long again. Below Even, the reverse.',
			text: formatLilt,
			toSlider: liltNotch,
			fromSlider: (p) => LILT_NOTCHES[p] ?? 1,
			min: 0,
			max: LILT_NOTCHES.length - 1,
			step: 1
		},
		{
			field: 'accent',
			label: 'Accent',
			hint: 'The strong quavers louder, the others softer. Below 0, the reverse.',
			text: (v) => (v === 0 ? 'Off' : signed(v)),
			toSlider: (v) => v,
			fromSlider: (p) => p,
			min: -100,
			max: 100,
			step: 5
		},
		{
			field: 'attack',
			label: 'Attack',
			hint: 'The strong notes start sharper (or softer, below 0).',
			text: (v) => (v === 0 ? 'Off' : signed(v)),
			toSlider: (v) => v,
			fromSlider: (p) => p,
			min: -100,
			max: 100,
			step: 5
		}
	];

	/** Slider positions not yet applied (a drag in progress). */
	let draft = $state<Partial<Humanize>>({});
	let timer: ReturnType<typeof setTimeout> | undefined;
	const feel = $derived({
		lilt: settings.lilt,
		accent: settings.accent,
		attack: settings.attack,
		...draft
	});

	function commit() {
		clearTimeout(timer);
		timer = undefined;
		if (Object.keys(draft).length === 0) return;
		const patch = draft;
		draft = {};
		onchange(patch);
	}

	function slide(field: Amount, value: number, settled: boolean) {
		draft = { ...draft, [field]: value };
		clearTimeout(timer);
		if (settled) commit();
		else timer = setTimeout(commit, SETTLE_MS);
	}

	function setFeel(h: Humanize) {
		clearTimeout(timer);
		draft = {};
		onchange({ lilt: h.lilt, accent: h.accent, attack: h.attack });
	}

	const same = (a: Humanize, b: Humanize) =>
		a.lilt === b.lilt && a.accent === b.accent && a.attack === b.attack;

	onDestroy(commit);
</script>

<div class="synth-options" role="group" aria-label={label}>
	<div class="field">
		<label for="{uid}-instrument">Instrument</label>
		<select
			id="{uid}-instrument"
			value={settings.instrument}
			onchange={(e) => onchange({ instrument: e.currentTarget.value })}
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
			value={String(settings.timesThrough)}
			onchange={(e) => onchange({ timesThrough: Number(e.currentTarget.value) })}
		>
			{#each times as n (n)}
				<option value={String(n)}>{n}×</option>
			{/each}
		</select>
	</div>
	<label class="check">
		<input
			type="checkbox"
			checked={settings.chords}
			onchange={(e) => onchange({ chords: e.currentTarget.checked })}
		/>
		Chord accompaniment
	</label>
	<div class="humanize" role="group" aria-labelledby="{uid}-humanize">
		<div class="humanize-head">
			<span class="label" id="{uid}-humanize">Feel</span>
			<button
				type="button"
				class="btn-quiet"
				disabled={same(feel, HUMANIZE_OFF)}
				onclick={() => setFeel(HUMANIZE_OFF)}>As written</button
			>
			<button
				type="button"
				class="btn-quiet"
				disabled={same(feel, seed)}
				onclick={() => setFeel(seed)}>Default</button
			>
		</div>
		<p class="muted hint">
			On the strong quavers: 1, 3, 5, 7 of a reel’s bar, 1 and 4 of a jig’s. Below 0, the quavers
			between get the emphasis instead.
		</p>
		{#each AMOUNTS as amount (amount.field)}
			{@const value = feel[amount.field]}
			<div class="amount">
				<div class="row">
					<label for="{uid}-{amount.field}">{amount.label}</label>
					<output for="{uid}-{amount.field}" class="muted">{amount.text(value)}</output>
				</div>
				<input
					id="{uid}-{amount.field}"
					type="range"
					min={amount.min}
					max={amount.max}
					step={amount.step}
					value={amount.toSlider(value)}
					aria-valuetext={amount.text(value)}
					aria-describedby="{uid}-{amount.field}-hint"
					oninput={(e) =>
						slide(amount.field, amount.fromSlider(Number(e.currentTarget.value)), false)}
					onchange={(e) =>
						slide(amount.field, amount.fromSlider(Number(e.currentTarget.value)), true)}
				/>
				<p class="hint muted" id="{uid}-{amount.field}-hint">{amount.hint}</p>
			</div>
		{/each}
	</div>
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

	.humanize {
		flex: 1 1 100%;
		display: grid;
		gap: var(--space-1);
	}

	.humanize-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}

	.humanize-head .label {
		flex: 1;
		font-weight: 600;
		font-size: 0.875rem;
	}

	.humanize p {
		margin: 0;
	}

	.amount {
		display: grid;
	}

	.amount input {
		width: 100%;
	}

	.row {
		display: flex;
		justify-content: space-between;
		gap: var(--space-2);
	}

	.hint {
		margin: 0;
		font-size: 0.8125rem;
	}

	.check {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		min-height: var(--touch);
		font-weight: 400;
	}
</style>
