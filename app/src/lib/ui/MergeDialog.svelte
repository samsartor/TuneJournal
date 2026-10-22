<script lang="ts">
	// Confirm a merge (PLAN.md §6.4): pick the piece to keep, and for each field where the pieces
	// differ, which value to keep. Everything else (tags, recordings, links, practice) is combined.

	import { KIND_LABEL, untitled } from '#lib/domain/format.ts';
	import { formatKey } from '#lib/domain/key.ts';
	import { MERGE_FIELDS, type MergeField } from '#lib/domain/relations.ts';
	import type { Piece, PieceId } from '#lib/domain/types.ts';
	import { library } from '#lib/store/library.svelte.ts';
	import { ui } from './state.svelte.ts';

	let dialog: HTMLDialogElement;

	const FIELD_LABEL: Record<MergeField, string> = {
		title: 'Title',
		kind: 'Kind',
		description: 'Description',
		key: 'Key',
		firstNotes: 'First notes'
	};

	const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

	const pieces = $derived(
		(ui.merging ?? [])
			.map((id) => library.doc?.pieces[id])
			.filter((p): p is Piece => !!p && p.deletedAt === undefined && p.mergedInto === undefined)
	);

	let survivorId = $state<PieceId>();
	let chosen = $state<Partial<Record<MergeField, PieceId>>>({});

	const survivor = $derived(pieces.find((p) => p.id === survivorId) ?? pieces[0]);

	$effect(() => {
		if (ui.merging && !dialog.open) {
			survivorId = ui.merging[0];
			chosen = {};
			dialog.showModal();
		} else if (!ui.merging && dialog.open) {
			dialog.close();
		}
	});

	/** The piece a field comes from when the user hasn't picked: as mergePieces decides it. */
	function defaultSource(field: MergeField): Piece | undefined {
		if (!survivor) return undefined;
		if (field === 'kind' || survivor[field] !== undefined) return survivor;
		return pieces.find((p) => p !== survivor && p[field] !== undefined) ?? survivor;
	}

	function display(field: MergeField, piece: Piece): string {
		const value = piece[field];
		if (value === undefined) return '(none)';
		if (field === 'kind') return KIND_LABEL[piece.kind];
		if (field === 'key') return formatKey(String(value));
		return String(value);
	}

	/** For each field the pieces disagree on: one option per distinct value. */
	const choices = $derived(
		MERGE_FIELDS.map((field) => {
			const options: { id: PieceId; label: string }[] = [];
			for (const piece of pieces) {
				const label = display(field, piece);
				if (!options.some((o) => o.label === label)) options.push({ id: piece.id, label });
			}
			return { field, options };
		}).filter((c) => c.options.length > 1)
	);

	function selected(field: MergeField): string | undefined {
		const id = chosen[field];
		const source = (id && pieces.find((p) => p.id === id)) || defaultSource(field);
		return source ? display(field, source) : undefined;
	}

	function confirm() {
		if (!survivor) return;
		const losers = pieces.filter((p) => p !== survivor).map((p) => p.id);
		// Send every visible choice, so what the dialog shows is what gets kept.
		const fields: Partial<Record<MergeField, PieceId>> = {};
		for (const { field, options } of choices) {
			const label = selected(field);
			const option = options.find((o) => o.label === label);
			if (option) fields[field] = option.id;
		}
		void ui.merge(survivor.id, losers, fields);
	}

	function name(p: Piece) {
		return p.title ?? untitled(p.kind);
	}
</script>

<dialog bind:this={dialog} onclose={() => ui.closeMerge()} aria-labelledby="merge-heading">
	{#if ui.merging && pieces.length > 1 && survivor}
		<div class="sheet">
			<h2 id="merge-heading">Merge {pieces.length} pieces</h2>
			<p class="muted">
				The merged piece keeps every tag, recording, link and practice entry, the higher skill, and
				the favorite star. The others are removed.
			</p>

			<fieldset>
				<legend>Keep</legend>
				{#each pieces as piece (piece.id)}
					<label class="option">
						<input
							type="radio"
							name="merge-survivor"
							value={piece.id}
							checked={piece === survivor}
							onchange={() => (survivorId = piece.id)}
						/>
						<span>
							<strong>{name(piece)}</strong>
							<span class="muted small"
								>{KIND_LABEL[piece.kind]} · added {dateFormat.format(piece.createdAt)} · practiced {piece
									.practice.length}
								{piece.practice.length === 1 ? 'time' : 'times'}</span
							>
						</span>
					</label>
				{/each}
			</fieldset>

			{#each choices as { field, options } (field)}
				<fieldset>
					<legend>{FIELD_LABEL[field]}</legend>
					{#each options as option (option.id)}
						<label class="option">
							<input
								type="radio"
								name="merge-{field}"
								value={option.id}
								checked={selected(field) === option.label}
								onchange={() => (chosen[field] = option.id)}
							/>
							<span class:abc={field === 'firstNotes'} class="value">{option.label}</span>
						</label>
					{/each}
				</fieldset>
			{/each}

			<div class="buttons">
				<button type="button" onclick={confirm}>Merge</button>
				<button type="button" class="btn-quiet" onclick={() => dialog.close()}>Cancel</button>
			</div>
		</div>
	{/if}
</dialog>

<style>
	dialog {
		width: min(32rem, calc(100% - 2 * var(--space-3)));
		max-height: calc(100dvh - 2 * var(--space-3));
		padding: 0;
		border: none;
		border-radius: var(--radius);
		background: var(--color-bg);
		color: var(--color-text);
		box-shadow: var(--shadow);
	}

	dialog::backdrop {
		background: rgb(0 0 0 / 0.4);
	}

	.sheet {
		display: grid;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-3) var(--space-4);
	}

	h2 {
		margin: 0;
		font-size: 1.125rem;
	}

	p {
		margin: 0;
	}

	fieldset {
		display: grid;
		gap: var(--space-1);
		margin: 0;
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
	}

	legend {
		padding: 0 var(--space-1);
		font-weight: 600;
	}

	.option {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-height: var(--touch);
	}

	.option input {
		flex: none;
		width: 1.25rem;
		height: 1.25rem;
		min-height: 0;
		accent-color: var(--color-accent);
	}

	.option > span {
		display: grid;
		min-width: 0;
	}

	.value {
		overflow-wrap: anywhere;
		white-space: pre-wrap;
	}

	.small {
		font-size: 0.875rem;
	}

	.abc {
		font-family: var(--font-mono);
	}

	.buttons {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
</style>
