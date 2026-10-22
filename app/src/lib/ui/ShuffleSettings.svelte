<!--
	Shuffle settings (PLAN.md §6.5), synced in `settings.shuffle`: the three temperatures, which
	kinds to include, the skill range, and whether to follow the main list's filter. Every change
	saves at once, and the count of matching pieces updates live.
-->
<script lang="ts">
	import { KINDS, KIND_PLURAL } from '#lib/domain/format.ts';
	import { setShuffleSettings } from '#lib/domain/ops.ts';
	import {
		SLIDER_STEPS,
		sliderPosition,
		temperatureAt,
		temperatureLabel,
		type ShuffleSettings
	} from '#lib/domain/shuffle.ts';
	import type { PieceKind, Temperature } from '#lib/domain/types.ts';
	import { library } from '#lib/store/library.svelte.ts';
	import SkillRange from './SkillRange.svelte';

	let {
		open = $bindable(false),
		settings,
		matching,
		remaining
	}: {
		open?: boolean;
		settings: ShuffleSettings;
		/** Pieces that match the settings. */
		matching: number;
		/** Of those, the ones not shown yet this session. */
		remaining: number;
	} = $props();

	let dialog: HTMLDialogElement;

	$effect(() => {
		if (open && !dialog.open) dialog.showModal();
		else if (!open && dialog.open) dialog.close();
	});

	function set(patch: Partial<ShuffleSettings>) {
		library.change((d) => setShuffleSettings(d, patch));
	}

	type TempField = 'tAge' | 'tSkill' | 'tFav';
	const TEMPS: { field: TempField; label: string; low: string; hint: string }[] = [
		{
			field: 'tAge',
			label: 'Age',
			low: 'Stalest first',
			hint: 'Pieces you haven’t practised for a while.'
		},
		{
			field: 'tSkill',
			label: 'Skill',
			low: 'Weakest first',
			hint: 'Pieces you rate lower. Unrated counts as 1.'
		},
		{
			field: 'tFav',
			label: 'Favorite',
			low: 'Favorites first',
			hint: 'Starred pieces, and ones you play often.'
		}
	];

	function valueText(t: Temperature) {
		return t === null ? 'Off, random' : `${temperatureLabel(t)}, T = ${t}`;
	}

	function toggleKind(kind: PieceKind, on: boolean) {
		set({ kinds: { ...settings.kinds, [kind]: on } });
	}
</script>

<dialog
	bind:this={dialog}
	onclose={() => (open = false)}
	aria-labelledby="shuffle-settings-heading"
	class="settings"
>
	{#if open}
		<div class="sheet">
			<header>
				<h2 id="shuffle-settings-heading">Shuffle settings</h2>
				<button type="button" onclick={() => (open = false)}>Done</button>
			</header>

			<p class="count" aria-live="polite" data-testid="shuffle-count">
				<strong>{matching}</strong>
				{matching === 1 ? 'piece matches' : 'pieces match'}
				{#if remaining < matching}
					<span class="muted">{`· ${remaining} left this round`}</span>
				{/if}
			</p>

			<section aria-labelledby="priority-heading">
				<h3 id="priority-heading">What comes up first</h3>
				<p class="note muted">
					Slide left to favour a factor strongly, right to ignore it. All the way right on every
					slider is a plain random shuffle.
				</p>
				{#each TEMPS as temp (temp.field)}
					{@const t = settings[temp.field]}
					<div class="temp">
						<div class="row">
							<label for="shuffle-{temp.field}">{temp.label}</label>
							<output for="shuffle-{temp.field}" class="muted"
								>{t === null ? 'Off' : temperatureLabel(t)}</output
							>
						</div>
						<input
							id="shuffle-{temp.field}"
							type="range"
							min="0"
							max={SLIDER_STEPS}
							step="1"
							value={sliderPosition(t)}
							aria-valuetext={valueText(t)}
							aria-describedby="shuffle-{temp.field}-hint"
							oninput={(e) => set({ [temp.field]: temperatureAt(Number(e.currentTarget.value)) })}
						/>
						<div class="ends" aria-hidden="true">
							<span>{temp.low}</span><span>Random</span>
						</div>
						<p class="note muted" id="shuffle-{temp.field}-hint">{temp.hint}</p>
					</div>
				{/each}
			</section>

			<section aria-labelledby="include-heading">
				<h3 id="include-heading">Include</h3>
				<div class="kinds" role="group" aria-label="Kinds">
					{#each KINDS as kind (kind)}
						<label class="check">
							<input
								type="checkbox"
								checked={settings.kinds[kind]}
								onchange={(e) => toggleKind(kind, e.currentTarget.checked)}
							/>
							{KIND_PLURAL[kind]}
						</label>
					{/each}
				</div>

				<SkillRange
					id="shuffle-skill-range"
					min={settings.skillMin}
					max={settings.skillMax}
					onchange={(range) => set(range)}
				/>
				<p class="note muted">Unrated pieces count as 1.</p>

				<label class="check">
					<input
						type="checkbox"
						checked={settings.respectListFilter ?? false}
						onchange={(e) => set({ respectListFilter: e.currentTarget.checked })}
					/>
					<span
						>Respect current list filter <span class="muted"
							>(the list’s filters, not its search)</span
						></span
					>
				</label>
			</section>
		</div>
	{/if}
</dialog>

<style>
	dialog {
		width: 100%;
		max-width: 100%;
		max-height: 100dvh;
		height: 100dvh;
		margin: 0;
		padding: 0;
		border: none;
		background: var(--color-bg);
		color: var(--color-text);
	}

	dialog::backdrop {
		background: rgb(0 0 0 / 0.4);
	}

	.sheet {
		display: grid;
		gap: var(--space-4);
		padding: var(--space-3);
		padding-bottom: calc(var(--space-4) + env(safe-area-inset-bottom));
	}

	header {
		position: sticky;
		top: 0;
		z-index: 2;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		margin: calc(-1 * var(--space-3)) calc(-1 * var(--space-3)) 0;
		padding: var(--space-2) var(--space-3);
		background: var(--color-bg);
		border-bottom: 1px solid var(--color-border);
	}

	h2 {
		margin: 0;
		font-size: 1.125rem;
	}

	h3 {
		margin: 0;
		font-size: 1rem;
	}

	section {
		display: grid;
		gap: var(--space-3);
	}

	.count {
		margin: 0;
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius);
		background: var(--color-accent-soft);
	}

	.note {
		margin: 0;
		font-size: 0.875rem;
	}

	.temp {
		display: grid;
		gap: 0;
	}

	.temp .note {
		margin-top: var(--space-1);
	}

	.row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-2);
	}

	.row label {
		font-weight: 600;
	}

	.temp input {
		width: 100%;
	}

	.ends {
		display: flex;
		justify-content: space-between;
		gap: var(--space-2);
		color: var(--color-muted);
		font-size: 0.8125rem;
	}

	.kinds {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0 var(--space-3);
	}

	.check {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-height: var(--touch);
	}

	@media (min-width: 40rem) {
		dialog {
			width: min(32rem, calc(100% - 2 * var(--space-4)));
			height: auto;
			max-height: calc(100dvh - 2 * var(--space-4));
			margin: auto;
			border-radius: var(--radius);
			box-shadow: var(--shadow);
		}

		.sheet {
			padding: var(--space-4);
		}

		header {
			margin: calc(-1 * var(--space-4)) calc(-1 * var(--space-4)) 0;
			padding: var(--space-2) var(--space-4);
		}

		.kinds {
			grid-template-columns: repeat(4, auto);
			justify-content: start;
		}
	}
</style>
