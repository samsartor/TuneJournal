<script lang="ts">
	import { MODES, TONICS, normalizeKey, parseKey } from '#lib/domain/key.ts';

	let {
		value,
		onchange,
		id = 'key'
	}: { value?: string; onchange: (key: string | null) => void; id?: string } = $props();

	// Free text is the source of truth; the pickers reflect it whenever it parses.
	// svelte-ignore state_referenced_locally
	let text = $state(value ?? '');
	let focused = $state(false);

	$effect(() => {
		// Pick up changes made elsewhere, but never rewrite what the user is typing.
		const current = value ?? '';
		if (!focused) text = current;
	});

	const parsed = $derived(parseKey(text));
	const hint = $derived.by(() => {
		const normalized = normalizeKey(text);
		if (!normalized || normalized === text.trim()) return '';
		return parsed ? `Saved as ${normalized}` : '';
	});

	function commit(next: string) {
		text = next;
		onchange(next.trim() ? next : null);
	}

	function pickTonic(e: Event) {
		const tonic = (e.currentTarget as HTMLSelectElement).value;
		commit(tonic ? `${tonic} ${parsed?.mode ?? 'major'}` : '');
	}

	function pickMode(e: Event) {
		const mode = (e.currentTarget as HTMLSelectElement).value;
		if (parsed) commit(`${parsed.tonic} ${mode}`);
	}
</script>

<fieldset class="key">
	<legend>Key</legend>
	<div class="pickers">
		<select aria-label="Tonic" value={parsed?.tonic ?? ''} onchange={pickTonic}>
			<option value="">—</option>
			{#each TONICS as tonic (tonic)}<option value={tonic}>{tonic}</option>{/each}
		</select>
		<select aria-label="Mode" value={parsed?.mode ?? ''} onchange={pickMode} disabled={!parsed}>
			{#if !parsed}<option value="">mode</option>{/if}
			{#each MODES as mode (mode)}<option value={mode}>{mode}</option>{/each}
		</select>
		<input
			{id}
			type="text"
			aria-label="Key as text"
			placeholder="or type, e.g. Ador"
			autocomplete="off"
			autocapitalize="off"
			bind:value={text}
			oninput={() => onchange(text.trim() ? text : null)}
			onfocus={() => (focused = true)}
			onblur={() => (focused = false)}
		/>
	</div>
	{#if hint}<p class="hint muted">{hint}</p>{/if}
</fieldset>

<style>
	fieldset {
		border: none;
		margin: 0;
		padding: 0;
		min-width: 0;
	}

	legend {
		font-weight: 600;
		padding: 0;
		margin-bottom: var(--space-1);
	}

	.pickers {
		display: grid;
		grid-template-columns: 5rem 8rem 1fr;
		gap: var(--space-2);
	}

	.pickers input {
		min-width: 0;
	}

	@media (max-width: 26rem) {
		.pickers {
			grid-template-columns: 5rem 1fr;
		}

		.pickers input {
			grid-column: 1 / -1;
		}
	}

	.hint {
		margin: var(--space-1) 0 0;
		font-size: 0.875rem;
	}
</style>
