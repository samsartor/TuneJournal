<!--
	Edit one recording (PLAN.md §5, §6.2): its title, the key and first notes as played in it (which
	the piece inherits when it has none of its own), and what it points at. A thesession.org link can
	be moved to another tune or setting (in the thesession.org picker, which covers this dialog); other links can be corrected, which
	finds the provider again and refreshes the title preview. Playable recordings offer Trim.
	Fields save when they change, like the edit modal.
-->
<script lang="ts">
	import { tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { hasKey } from '#lib/domain/derived.ts';
	import { formatKey } from '#lib/domain/key.ts';
	import { PROVIDERS, openLinkOf, recordingTitle } from '#lib/domain/providers.ts';
	import { relinkClip, updateClip, type ClipPatch } from '#lib/domain/recordings.ts';
	import { profileFor } from '#lib/domain/playback.ts';
	import { INSTRUMENTS, INSTRUMENT_IDS, isInstrument, synthTarget } from '#lib/domain/synth.ts';
	import { tuneClipId } from '#lib/domain/thesession.ts';
	import type { ClipId, PieceId } from '#lib/domain/types.ts';
	import type { ResolvedPathname } from '$app/types';
	import { detectLink } from '#lib/integrations/links.ts';
	import { library } from '#lib/store/library.svelte.ts';
	import { oembed } from '#lib/store/oembed.svelte.ts';
	import { synth } from '#lib/store/synth.svelte.ts';
	import { theSession } from '#lib/store/thesession.svelte.ts';
	import KeyInput from './KeyInput.svelte';
	import Notation from './Notation.svelte';
	import ProviderIcon from './ProviderIcon.svelte';
	import TheSessionPicker from './TheSessionPicker.svelte';
	import { sourceFromLink } from './recordings.ts';

	let {
		pieceId,
		clipId: initialClipId,
		onclose,
		ontrim
	}: {
		pieceId: PieceId;
		clipId: ClipId;
		onclose: () => void;
		/** Close this and open the trim editor on the (current) clip. */
		ontrim?: (clipId: ClipId) => void;
	} = $props();

	const uid = $props.id();
	let dialog: HTMLDialogElement;
	// Relinking to another thesession tune replaces the link's clip (its id is the tune's).
	// svelte-ignore state_referenced_locally
	let clipId = $state(initialClipId);
	const piece = $derived(library.doc?.pieces[pieceId]);
	const clip = $derived(piece?.clips[clipId]);
	const source = $derived(clip ? library.doc?.sources[clip.sourceId] : undefined);
	const index = $derived(library.index);
	const pieceKey = $derived(piece && index ? index.effectiveKey(piece) : undefined);
	const pieceNotes = $derived(piece && index ? index.effectiveFirstNotes(piece) : undefined);
	const lookedUp = $derived(source ? oembed.lookup(source)?.title : undefined);

	const thesession = $derived(piece?.external?.thesession);
	/** This clip is the piece's link to its thesession tune. */
	const tuneLink = $derived(
		thesession?.tuneId !== undefined && clipId === tuneClipId(thesession.tuneId)
			? thesession.tuneId
			: undefined
	);
	const tuneData = $derived(tuneLink !== undefined ? theSession.tune(tuneLink) : undefined);
	const tuneName = $derived(tuneData?.data?.name ?? piece?.title ?? `tune ${tuneLink}`);
	const settingNumber = $derived.by(() => {
		const settings = tuneData?.data?.settings;
		const i = settings?.findIndex((s) => s.id === thesession?.settingId) ?? -1;
		return i >= 0 ? i + 1 : undefined;
	});
	/** A link that can be corrected by pasting another (not files, nor the tune or set link). */
	const editableLink = $derived(
		!!source &&
			tuneLink === undefined &&
			!clipId.startsWith('thesession:set:') &&
			!['upload', 'gdrive', 'grecorder'].includes(source.provider)
	);
	const openHref = $derived(source ? openLinkOf(source) : undefined);
	/** The setting this thesession link plays, synthesized. */
	const synthOf = $derived(piece && source ? synthTarget(piece, source) : undefined);
	/** The tag playback profile it plays with (only the instrument can be changed here). */
	const profile = $derived(
		synthOf && piece && library.doc ? profileFor(library.doc, piece) : undefined
	);
	const profileHref = $derived(
		`${resolve('/settings')}${profile?.key ? `?profile=${encodeURIComponent(profile.key)}` : ''}#synth` as ResolvedPathname
	);
	let showNotation = $state(false);

	// svelte-ignore state_referenced_locally
	let title = $state(clip?.title ?? '');
	// svelte-ignore state_referenced_locally
	let firstNotes = $state(clip?.firstNotes ?? '');
	// svelte-ignore state_referenced_locally
	let url = $state(source?.url ?? '');
	let urlError = $state('');
	let urlStatus = $state('');
	/** The thesession.org picker is open, covering this dialog. */
	let searching = $state<'tune' | 'setting'>();
	let tuneButton = $state<HTMLButtonElement>();
	let settingButton = $state<HTMLButtonElement>();

	$effect(() => {
		dialog.showModal();
	});

	/** Re-reads the text fields after something other than typing changed the clip. */
	function sync() {
		const p = library.doc?.pieces[pieceId];
		const ts = p?.external?.thesession;
		// After moving to another tune, the link's clip has the new tune's id.
		if (
			p &&
			!p.clips[clipId] &&
			clipId.startsWith('thesession:tune:') &&
			ts?.tuneId !== undefined
		) {
			clipId = tuneClipId(ts.tuneId);
		}
		const c = p?.clips[clipId];
		title = c?.title ?? '';
		firstNotes = c?.firstNotes ?? '';
		url = (c && library.doc?.sources[c.sourceId]?.url) ?? '';
	}

	function save(patch: ClipPatch) {
		if (clip) library.change((d) => updateClip(d, pieceId, clipId, patch));
	}

	// The key input reports every keystroke; save it after a pause, like the edit modal.
	let keyTimer: ReturnType<typeof setTimeout> | undefined;
	let pendingKey: { key: string | null } | undefined;

	function queueKey(key: string | null) {
		pendingKey = { key };
		clearTimeout(keyTimer);
		keyTimer = setTimeout(flushKey, 400);
	}

	function flushKey() {
		clearTimeout(keyTimer);
		if (pendingKey) save(pendingKey);
		pendingKey = undefined;
	}

	function flushText() {
		flushKey();
		if (!clip) return;
		if (title !== (clip.title ?? '')) save({ title });
		if (firstNotes !== (clip.firstNotes ?? '')) save({ firstNotes });
	}

	function updateLink(e: SubmitEvent) {
		e.preventDefault();
		urlError = '';
		urlStatus = '';
		const link = detectLink(url);
		if (!link) {
			urlError = url.trim() ? 'That doesn’t look like a link.' : 'Paste a link first.';
			return;
		}
		const changed = library.change((d) =>
			relinkClip(d, pieceId, clipId, sourceFromLink(link), { start: link.start })
		);
		url = link.url;
		urlStatus = changed
			? `Now linked to ${PROVIDERS[link.provider].label}.`
			: 'That’s the same link.';
	}

	function close() {
		flushText();
		onclose();
	}

	/** Back from the picker: this dialog shows again, with focus on the button that opened it. */
	async function pickerClosed() {
		const opener = searching === 'setting' ? settingButton : tuneButton;
		searching = undefined;
		await tick();
		opener?.focus();
	}

	async function leaveTo(id: PieceId) {
		searching = undefined;
		dialog.close();
		await goto(resolve('/(main)/piece/[id]', { id }));
	}
</script>

<dialog
	bind:this={dialog}
	onclose={close}
	class:covered={searching}
	aria-labelledby="{uid}-heading"
>
	{#if piece && clip && source}
		<div class="sheet">
			<header>
				<h2 id="{uid}-heading">Edit recording</h2>
				<button type="button" onclick={() => dialog.close()}>Done</button>
			</header>

			<p class="provider">
				<ProviderIcon provider={source.provider} />
				<span>{PROVIDERS[source.provider].label}</span>
				{#if openHref}
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
					<a href={openHref} target="_blank" rel="noopener noreferrer">Open link ↗</a>
				{/if}
			</p>

			{#if tuneLink !== undefined}
				<div class="field" role="group" aria-labelledby="{uid}-tune">
					<span class="label" id="{uid}-tune">Linked tune</span>
					<p data-testid="linked-tune">
						{tuneName}{settingNumber !== undefined
							? `, setting ${settingNumber}`
							: thesession?.settingId !== undefined
								? `, setting ${thesession.settingId}`
								: ''}
					</p>
					<div class="buttons">
						<button
							type="button"
							class="btn-quiet"
							aria-haspopup="dialog"
							bind:this={tuneButton}
							onclick={() => {
								flushText();
								searching = 'tune';
							}}>Change tune…</button
						>
						<button
							type="button"
							class="btn-quiet"
							aria-haspopup="dialog"
							bind:this={settingButton}
							onclick={() => {
								flushText();
								searching = 'setting';
							}}>Change setting…</button
						>
					</div>
				</div>
				{#if synthOf}
					<div class="field" role="group" aria-labelledby="{uid}-synth">
						<span class="label" id="{uid}-synth">♪ Synthesized playback</span>
						<p class="muted small">
							Plays this setting from its ABC, so it isn’t a real recording.
						</p>
						{#if profile}
							<p data-testid="playback-profile">
								Playback: {profile.label} profile ·
								<a href={profileHref} onclick={() => dialog.close()}>Change in Settings</a>
							</p>
							<div class="field">
								<label for="{uid}-instrument">Instrument</label>
								<select
									id="{uid}-instrument"
									value={isInstrument(clip.instrument) ? clip.instrument : ''}
									onchange={(e) => save({ instrument: e.currentTarget.value || null })}
								>
									<option value=""
										>From profile ({INSTRUMENTS[
											isInstrument(profile.settings.instrument)
												? profile.settings.instrument
												: 'fiddle'
										].label})</option
									>
									{#each INSTRUMENT_IDS as id (id)}
										<option value={id}>{INSTRUMENTS[id].label}</option>
									{/each}
								</select>
							</div>
						{/if}
						<div class="buttons">
							<button
								type="button"
								class="btn-quiet"
								aria-pressed={showNotation}
								onclick={() => (showNotation = !showNotation)}>Show notation</button
							>
						</div>
						{#if showNotation}
							{#key `${synthOf.tuneId}:${synthOf.settingId}`}
								<Notation target={synthOf} {pieceId} {clipId} />
							{/key}
						{/if}
					</div>
				{/if}
			{:else if editableLink}
				<form class="field" onsubmit={updateLink} novalidate>
					<label for="{uid}-url">Link</label>
					<div class="row">
						<input
							id="{uid}-url"
							type="url"
							inputmode="url"
							autocomplete="off"
							spellcheck="false"
							bind:value={url}
							oninput={() => {
								urlError = '';
								urlStatus = '';
							}}
						/>
						<button type="submit" class="btn-quiet">Update link</button>
					</div>
					{#if urlError}<p class="error" role="alert">{urlError}</p>{/if}
					{#if urlStatus}<p class="muted small" role="status">{urlStatus}</p>{/if}
				</form>
			{/if}

			<div class="field">
				<label for="{uid}-title">Title</label>
				<input
					id="{uid}-title"
					type="text"
					autocomplete="off"
					placeholder={recordingTitle({}, source, lookedUp)}
					bind:value={title}
					onchange={() => save({ title })}
				/>
			</div>

			{#if hasKey(piece)}
				<p class="muted small">
					{#if tuneLink !== undefined}
						Key and first notes of the linked setting. The {piece.kind} shows them unless it has its own.
					{:else}
						Key and first notes as played in this recording, if they differ from the {piece.kind}’s
						({pieceKey ? formatKey(pieceKey) : 'no key'}{pieceNotes ? `, ${pieceNotes}` : ''}).
					{/if}
				</p>
				{#key clipId}
					<KeyInput id="{uid}-key" value={clip.key} onchange={queueKey} />
				{/key}
				<div class="field">
					<label for="{uid}-notes">First notes (ABC)</label>
					<input
						id="{uid}-notes"
						class="abc"
						type="text"
						autocomplete="off"
						spellcheck="false"
						placeholder={tuneLink === undefined ? (pieceNotes ?? '') : ''}
						bind:value={firstNotes}
						onchange={() => save({ firstNotes })}
					/>
				</div>
			{/if}

			{#if ontrim && synth.playable(piece, source)}
				<div class="buttons">
					<button
						type="button"
						class="btn-quiet"
						onclick={() => {
							const id = clipId;
							dialog.close();
							ontrim(id);
						}}>Trim…</button
					>
				</div>
			{/if}
		</div>
	{/if}
</dialog>

{#if searching && piece}
	{#key searching}
		<TheSessionPicker
			{pieceId}
			initialQuery={piece.title ?? ''}
			isNew={false}
			settingsOf={searching === 'setting' && tuneLink !== undefined
				? { tuneId: tuneLink, name: tuneName }
				: undefined}
			beforeApply={flushText}
			onapplied={sync}
			onclose={pickerClosed}
			onleave={leaveTo}
		/>
	{/key}
{/if}

<style>
	dialog {
		width: min(32rem, calc(100% - 2 * var(--space-3)));
		max-height: calc(100dvh - 2 * var(--space-3));
		padding: 0;
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-bg);
		color: var(--color-text);
		box-shadow: var(--shadow);
	}

	dialog::backdrop {
		background: rgb(0 0 0 / 0.4);
	}

	/* The thesession.org picker takes this dialog's place while it's open. */
	dialog.covered {
		visibility: hidden;
	}

	.sheet {
		display: grid;
		gap: var(--space-3);
		padding: var(--space-3);
	}

	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}

	h2 {
		margin: 0;
		font-size: 1.25rem;
	}

	p {
		margin: 0;
	}

	.provider {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		color: var(--color-muted);
	}

	.provider a {
		margin-left: auto;
	}

	.field {
		display: grid;
		gap: var(--space-1);
	}

	label,
	.label {
		font-weight: 600;
	}

	.row,
	.buttons {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.row input {
		flex: 1;
		min-width: 0;
	}

	.abc {
		font-family: var(--font-mono);
	}

	.small {
		font-size: 0.875rem;
	}

	.error {
		color: var(--color-danger);
	}
</style>
