<script lang="ts">
	import { hasKey } from '#lib/domain/derived.ts';
	import { KINDS, KIND_LABEL } from '#lib/domain/format.ts';
	import { addTag, removeTag, updatePiece, type PiecePatch } from '#lib/domain/ops.ts';
	import type { PieceKind } from '#lib/domain/types.ts';
	import { library } from '#lib/store/library.svelte.ts';
	import KeyInput from './KeyInput.svelte';
	import SkillSlider from './SkillSlider.svelte';
	import TagInput from './TagInput.svelte';
	import { ui } from './state.svelte.ts';

	const TEXT_DELAY = 400;

	let dialog: HTMLDialogElement;

	const editing = $derived(ui.editing);
	const piece = $derived(editing ? library.doc?.pieces[editing.id] : undefined);
	const index = $derived(library.index);

	// Text fields are local while typing and saved after a pause, so each keystroke isn't a change.
	let title = $state('');
	let description = $state('');
	let firstNotes = $state('');
	let pending: PiecePatch = {};
	let timer: ReturnType<typeof setTimeout> | undefined;

	$effect(() => {
		if (editing && !dialog.open) {
			const p = library.doc?.pieces[editing.id];
			title = p?.title ?? '';
			description = p?.description ?? '';
			firstNotes = p?.firstNotes ?? '';
			dialog.showModal();
		} else if (!editing && dialog.open) {
			dialog.close();
		}
	});

	function save(patch: PiecePatch) {
		const id = editing?.id;
		if (id) library.change((d) => updatePiece(d, id, patch));
	}

	function queue(patch: PiecePatch) {
		Object.assign(pending, patch);
		clearTimeout(timer);
		timer = setTimeout(flush, TEXT_DELAY);
	}

	function flush() {
		clearTimeout(timer);
		const patch = pending;
		pending = {};
		if (Object.keys(patch).length > 0) save(patch);
	}

	function onclose() {
		flush();
		ui.closeEdit();
	}

	function onTag(op: typeof addTag | typeof removeTag, tag: string) {
		const id = editing?.id;
		if (id) library.change((d) => void op(d, id, tag));
	}
</script>

<dialog bind:this={dialog} {onclose} aria-labelledby="edit-heading">
	{#if editing && piece && index}
		<div class="sheet">
			<header>
				<h2 id="edit-heading">
					{editing.isNew ? 'New' : 'Edit'}
					{KIND_LABEL[piece.kind].toLowerCase()}
				</h2>
				<button type="button" onclick={() => dialog.close()}>Done</button>
			</header>

			<div class="fields">
				<div class="field">
					<label for="edit-kind">Kind</label>
					<select
						id="edit-kind"
						value={piece.kind}
						onchange={(e) => save({ kind: e.currentTarget.value as PieceKind })}
					>
						{#each KINDS as kind (kind)}<option value={kind}>{KIND_LABEL[kind]}</option>{/each}
					</select>
				</div>

				<div class="field">
					<label for="edit-title">Title</label>
					<!-- svelte-ignore a11y_autofocus -->
					<input
						id="edit-title"
						type="text"
						autocomplete="off"
						autofocus={editing.isNew}
						bind:value={title}
						oninput={() => queue({ title })}
						onkeydown={(e) => e.key === 'Enter' && flush()}
					/>
				</div>

				<div class="field">
					<label for="edit-description">Description</label>
					<textarea
						id="edit-description"
						rows="3"
						bind:value={description}
						oninput={() => queue({ description })}></textarea>
				</div>

				<TagInput
					id="edit-tags"
					tags={index.tagsOf(piece)}
					suggestions={index.tags}
					onadd={(tag) => onTag(addTag, tag)}
					onremove={(tag) => onTag(removeTag, tag)}
				/>

				<SkillSlider id="edit-skill" skill={piece.skill} onchange={(skill) => save({ skill })} />

				<label class="check">
					<input
						type="checkbox"
						checked={piece.favorite}
						onchange={(e) => save({ favorite: e.currentTarget.checked })}
					/>
					<span>Favorite ★</span>
				</label>

				{#if hasKey(piece)}
					<KeyInput id="edit-key" value={piece.key} onchange={(key) => save({ key })} />

					<div class="field">
						<label for="edit-first-notes">First notes <span class="muted">(ABC)</span></label>
						<input
							id="edit-first-notes"
							class="abc"
							type="text"
							autocomplete="off"
							autocapitalize="off"
							spellcheck="false"
							placeholder="e.g. A2 FA dAFA"
							bind:value={firstNotes}
							oninput={() => queue({ firstNotes })}
						/>
					</div>
				{/if}
			</div>

			<p class="muted note">Changes save as you go.</p>
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
		gap: var(--space-3);
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

	.fields {
		display: grid;
		gap: var(--space-4);
	}

	.field {
		display: grid;
		gap: var(--space-1);
	}

	.field > label {
		font-weight: 600;
	}

	.check {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-height: var(--touch);
		font-weight: 600;
	}

	.abc {
		font-family: var(--font-mono);
	}

	.note {
		margin: 0;
		font-size: 0.875rem;
	}

	@media (min-width: 40rem) {
		dialog {
			width: min(36rem, calc(100% - 2 * var(--space-4)));
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
	}
</style>
