<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { hasKey } from '#lib/domain/derived.ts';
	import { KINDS, KIND_LABEL } from '#lib/domain/format.ts';
	import { addTag, removeTag, updatePiece, type PiecePatch } from '#lib/domain/ops.ts';
	import { tuneUrl, unlinkTheSession } from '#lib/domain/thesession.ts';
	import type { PieceId, PieceKind } from '#lib/domain/types.ts';
	import { library } from '#lib/store/library.svelte.ts';
	import KeyInput from './KeyInput.svelte';
	import SkillSlider from './SkillSlider.svelte';
	import TagInput from './TagInput.svelte';
	import TheSessionSearch from './TheSessionSearch.svelte';
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
	let searching = $state(false);

	const thesession = $derived(piece?.external?.thesession);

	/** Re-reads the text fields from the doc, after something other than typing changed them. */
	function syncText() {
		const p = editing ? library.doc?.pieces[editing.id] : undefined;
		title = p?.title ?? '';
		description = p?.description ?? '';
		firstNotes = p?.firstNotes ?? '';
	}

	$effect(() => {
		if (editing && !dialog.open) {
			syncText();
			searching = false;
			dialog.showModal();
		} else if (!editing && dialog.open) {
			dialog.close();
		}
	});

	/** Leaves the modal for another piece (an existing copy of the tune just searched for). */
	async function leaveTo(id: PieceId) {
		searching = false;
		dialog.close();
		await goto(resolve('/(main)/piece/[id]', { id }));
	}

	function unlink() {
		const id = editing?.id;
		if (id) library.change((d) => unlinkTheSession(d, id));
	}

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
					<div class="title-row">
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
						<button
							type="button"
							class="btn-quiet search-btn"
							aria-label="Search thesession.org"
							title="Search thesession.org"
							aria-expanded={searching}
							onclick={() => {
								flush();
								searching = !searching;
							}}>🔍</button
						>
					</div>
				</div>

				{#if searching}
					{#key editing.id}
						<TheSessionSearch
							pieceId={editing.id}
							initialQuery={title}
							isNew={editing.isNew}
							beforeApply={flush}
							onapplied={syncText}
							onclose={() => (searching = false)}
							onleave={leaveTo}
						/>
					{/key}
				{/if}

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

				{#if thesession}
					<div class="field">
						<span class="label" id="edit-external">Linked to</span>
						<div class="external" aria-labelledby="edit-external" role="group">
							{#if thesession.tuneId !== undefined}
								<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
								<a href={tuneUrl(thesession.tuneId)} target="_blank" rel="noopener noreferrer"
									>thesession.org tune {thesession.tuneId}{thesession.settingId !== undefined
										? `, setting ${thesession.settingId}`
										: ''} ↗</a
								>
							{:else if thesession.setId !== undefined}
								<span>thesession.org set {thesession.setId}</span>
							{/if}
							<button type="button" class="btn-quiet" onclick={unlink}>Unlink</button>
						</div>
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

	.field > label,
	.label {
		font-weight: 600;
	}

	.title-row {
		display: flex;
		gap: var(--space-2);
	}

	.title-row input {
		flex: 1;
		min-width: 0;
	}

	.search-btn {
		min-width: var(--touch);
		padding: 0;
	}

	.external {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
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
