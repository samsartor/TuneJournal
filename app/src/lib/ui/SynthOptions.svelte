<!--
	Options for synthesized playback of thesession settings (PLAN.md §6.6): instrument, style,
	times through the tune, chord accompaniment, and humanization (lilt, accent and attack on the
	strong quavers). Device-local, like the speed; changing one re-renders whatever synthesized tune
	is loaded in the player, in place. Shown in Settings and in a thesession recording's Edit dialog.
-->
<script lang="ts">
	import { onDestroy } from 'svelte';
	import {
		HUMANIZE_DEFAULTS,
		HUMANIZE_OFF,
		HUMANIZE_STYLES,
		liltRatio,
		type Humanize,
		type HumanizeStyle
	} from '#lib/domain/humanize.ts';
	import { INSTRUMENTS, INSTRUMENT_IDS, MAX_TIMES_THROUGH } from '#lib/domain/synth.ts';
	import type { InstrumentId } from '#lib/domain/synth.ts';
	import { synth } from '#lib/store/synth.svelte.ts';

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
	}[] = [
		{
			field: 'lilt',
			label: 'Lilt',
			hint: 'The strong quaver longer, the next ones shorter.',
			text: (v) => (v === 0 ? 'Even' : `${liltRatio(v)}`)
		},
		{
			field: 'accent',
			label: 'Accent',
			hint: 'The strong quavers louder, the others softer.',
			text: (v) => (v === 0 ? 'Off' : signed(v))
		},
		{
			field: 'attack',
			label: 'Attack',
			hint: 'The strong notes start sharper (or softer, below 0).',
			text: (v) => (v === 0 ? 'Off' : signed(v))
		}
	];

	/** Slider positions not yet applied (a drag in progress). */
	let draft = $state<Partial<Humanize>>({});
	let timer: ReturnType<typeof setTimeout> | undefined;
	const humanize = $derived({ ...synth.options.humanize, ...draft });

	function commit() {
		clearTimeout(timer);
		timer = undefined;
		if (Object.keys(draft).length === 0) return;
		const next = { ...synth.options.humanize, ...draft };
		draft = {};
		synth.setOptions({ humanize: next });
	}

	function slide(field: Amount, value: number, settled: boolean) {
		draft = { ...draft, [field]: value };
		clearTimeout(timer);
		if (settled) commit();
		else timer = setTimeout(commit, SETTLE_MS);
	}

	function setHumanize(h: Humanize) {
		clearTimeout(timer);
		draft = {};
		synth.setOptions({ humanize: h });
	}

	const same = (a: Humanize, b: Humanize) =>
		a.lilt === b.lilt && a.accent === b.accent && a.attack === b.attack;

	onDestroy(commit);
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
		<label for="{uid}-style">Style</label>
		<select
			id="{uid}-style"
			value={synth.options.humanize.style}
			aria-describedby="{uid}-style-hint"
			onchange={(e) =>
				synth.setOptions({
					humanize: { ...humanize, style: e.currentTarget.value as HumanizeStyle }
				})}
		>
			{#each Object.entries(HUMANIZE_STYLES) as [id, label] (id)}
				<option value={id}>{label}</option>
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
	<div class="humanize" role="group" aria-labelledby="{uid}-humanize">
		<div class="humanize-head">
			<span class="label" id="{uid}-humanize">Feel</span>
			<button
				type="button"
				class="btn-quiet"
				disabled={same(humanize, HUMANIZE_OFF)}
				onclick={() => setHumanize({ ...humanize, lilt: 0, accent: 0, attack: 0 })}
				>As written</button
			>
			<button
				type="button"
				class="btn-quiet"
				disabled={same(humanize, HUMANIZE_DEFAULTS)}
				onclick={() => setHumanize({ ...HUMANIZE_DEFAULTS, style: humanize.style })}>Default</button
			>
		</div>
		<p class="muted hint" id="{uid}-style-hint">
			On the strong quavers: 1, 3, 5, 7 of a reel's bar, 1 and 4 of a jig's. Old-time puts the
			accent and attack on the quavers between. Below 0 does the reverse.
		</p>
		{#each AMOUNTS as amount (amount.field)}
			{@const value = humanize[amount.field]}
			<div class="amount">
				<div class="row">
					<label for="{uid}-{amount.field}">{amount.label}</label>
					<output for="{uid}-{amount.field}" class="muted">{amount.text(value)}</output>
				</div>
				<input
					id="{uid}-{amount.field}"
					type="range"
					min="-100"
					max="100"
					step="5"
					{value}
					aria-valuetext={amount.text(value)}
					aria-describedby="{uid}-{amount.field}-hint"
					oninput={(e) => slide(amount.field, Number(e.currentTarget.value), false)}
					onchange={(e) => slide(amount.field, Number(e.currentTarget.value), true)}
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
