<script lang="ts">
	import { onMount } from 'svelte';
	import { goto, replaceState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { AutomergeUrl } from '@automerge/automerge-repo/slim';
	import { library } from '#lib/store/library.svelte.ts';
	import { libraryDeepLink, parseLibraryLink } from '#lib/store/link.ts';
	import { FindLibraryError, findLibrary } from '#lib/store/repo.ts';
	import QrCode from '#lib/ui/QrCode.svelte';
	import QrScanner, { canScanQr } from '#lib/ui/QrScanner.svelte';
	import SyncIndicator from '#lib/ui/SyncIndicator.svelte';
	import { ui } from '#lib/ui/state.svelte.ts';

	type Phase = 'confirm' | 'waiting' | 'error';

	let input = $state('');
	let inputError = $state<string>();
	let pending = $state<AutomergeUrl>();
	let phase = $state<Phase>('confirm');
	let joinError = $state<string>();
	let mergeLocal = $state(false);
	let fromLink = $state(false);
	let scanning = $state(false);
	let canScan = $state(false);
	let copied = $state<'link' | 'url'>();
	let controller: AbortController | undefined;

	const pieceCount = $derived(library.index?.live.length ?? 0);
	const pieces = $derived(`${pieceCount} ${pieceCount === 1 ? 'piece' : 'pieces'}`);
	const deepLink = $derived(
		library.url
			? libraryDeepLink(
					new URL(resolve('/link-device'), page.url.origin),
					library.url as AutomergeUrl
				)
			: undefined
	);
	const alreadyHere = $derived(!!pending && pending === library.url);

	// A scanned QR code opens this page with the library in the hash.
	$effect(() => {
		const hash = page.url.hash.slice(1);
		if (!hash) return;
		const url = parseLibraryLink(hash);
		fromLink = true;
		if (url) {
			offer(url);
		} else {
			inputError = 'That link doesn’t contain a valid library address.';
		}
	});

	onMount(() => {
		canScanQr().then((ok) => (canScan = ok));
		return () => controller?.abort();
	});

	function offer(url: AutomergeUrl) {
		controller?.abort();
		pending = url;
		phase = 'confirm';
		joinError = undefined;
		inputError = undefined;
		mergeLocal = false;
	}

	function submit(e: SubmitEvent) {
		e.preventDefault();
		const url = parseLibraryLink(input);
		if (url) offer(url);
		else
			inputError = input.trim()
				? 'That isn’t a library address. It starts with “automerge:”, or is a link to this page.'
				: 'Paste a library address or link first.';
	}

	function scanned(text: string) {
		scanning = false;
		input = text;
		const url = parseLibraryLink(text);
		if (url) offer(url);
		else inputError = 'That QR code isn’t a TuneJournal library link.';
	}

	function cancel() {
		controller?.abort();
		pending = undefined;
		phase = 'confirm';
		joinError = undefined;
		if (page.url.hash) replaceState(resolve('/link-device'), {});
	}

	async function join() {
		if (!pending) return;
		controller?.abort();
		const ctrl = (controller = new AbortController());
		phase = 'waiting';
		joinError = undefined;
		try {
			const handle = await findLibrary(pending, { signal: ctrl.signal });
			if (ctrl.signal.aborted) return;
			const result = await library.switchTo(handle, { mergeLocal: mergeLocal && pieceCount > 0 });
			const count = library.index?.live.length ?? 0;
			let message = `Linked. This device now shows a library with ${count} ${count === 1 ? 'piece' : 'pieces'}.`;
			if (result?.mode === 'copied' && result.pieces > 0) {
				message = `Linked, and added ${result.pieces} ${result.pieces === 1 ? 'piece' : 'pieces'} from this device.`;
			}
			ui.showToast(message);
			await goto(resolve('/(main)'));
		} catch (e) {
			if (ctrl.signal.aborted) return;
			console.warn('Linking failed', e);
			joinError =
				e instanceof FindLibraryError
					? e.message
					: `Something went wrong: ${e instanceof Error ? e.message : String(e)}`;
			phase = 'error';
		}
	}

	async function copy(what: 'link' | 'url') {
		const text = what === 'link' ? deepLink : library.url;
		if (!text) return;
		await navigator.clipboard.writeText(text);
		copied = what;
		setTimeout(() => (copied = undefined), 2000);
	}
</script>

{#snippet showSection()}
	<section aria-labelledby="show-heading">
		<h2 id="show-heading">Show this library</h2>
		{#if library.status === 'ready' && deepLink}
			<p class="muted small">
				On your other device, scan this code with the camera, or open the link. It opens TuneJournal
				and offers to show this library there.
			</p>
			<QrCode text={deepLink} label="QR code linking to this library" />
			<div class="copyable">
				<code data-testid="deep-link">{deepLink}</code>
				<button type="button" class="btn-quiet" onclick={() => copy('link')}
					>{copied === 'link' ? 'Copied' : 'Copy link'}</button
				>
			</div>
			<details>
				<summary>Library address only</summary>
				<div class="copyable">
					<code data-testid="library-url">{library.url}</code>
					<button type="button" class="btn-quiet" onclick={() => copy('url')}
						>{copied === 'url' ? 'Copied' : 'Copy'}</button
					>
				</div>
			</details>
			<p class="muted small">
				Anyone with this link can read and change your library, so only share it with your own
				devices.
			</p>
		{:else if library.status === 'error'}
			<p>Couldn’t open this device’s library, so there’s nothing to show.</p>
		{:else}
			<p class="muted">Loading library…</p>
		{/if}
	</section>
{/snippet}

{#snippet joinSection()}
	<section aria-labelledby="join-heading">
		<h2 id="join-heading">Join a library</h2>
		{#if pending}
			<div class="confirm" role="group" aria-label="Confirm linking">
				{#if alreadyHere}
					<p>This device already shows that library.</p>
					<div class="buttons">
						<button type="button" class="btn-quiet" onclick={cancel}>OK</button>
					</div>
				{:else if phase === 'waiting'}
					<p class="waiting" role="status">
						<span class="spinner" aria-hidden="true"></span>
						Looking for the library on the sync server…
					</p>
					<div class="buttons">
						<button type="button" class="btn-quiet" onclick={cancel}>Cancel</button>
					</div>
				{:else}
					<p>Show this library on this device?</p>
					<code class="address" data-testid="pending-url">{pending}</code>
					{#if pieceCount > 0}
						<p class="warning">
							This device currently shows a library with {pieces}. Linking switches this device to
							the other library. Your current one stays saved on this device, but it won’t be shown
							any more.
						</p>
						<label class="check">
							<input type="checkbox" bind:checked={mergeLocal} />
							<span>Copy my {pieces} into the linked library</span>
						</label>
					{/if}
					{#if phase === 'error' && joinError}
						<p class="error" role="alert">{joinError}</p>
					{/if}
					<div class="buttons">
						<button type="button" onclick={join} disabled={library.status === 'loading'}
							>{phase === 'error' ? 'Try again' : 'Link this device'}</button
						>
						<button type="button" class="btn-quiet" onclick={cancel}>Cancel</button>
					</div>
				{/if}
			</div>
		{:else}
			<p class="muted small">
				To show a library from another device here, scan its QR code with your phone’s camera, or
				paste its link or address below.
			</p>
			<form class="paste" onsubmit={submit}>
				<label for="join-input">Library link or address</label>
				<div class="row">
					<input
						id="join-input"
						type="text"
						autocomplete="off"
						autocapitalize="off"
						spellcheck="false"
						placeholder="automerge:…"
						bind:value={input}
						aria-invalid={!!inputError}
						aria-describedby={inputError ? 'join-error' : undefined}
					/>
					<button type="submit">Continue</button>
				</div>
			</form>
			{#if canScan}
				{#if scanning}
					<QrScanner onscan={scanned} oncancel={() => (scanning = false)} />
				{:else}
					<button type="button" class="btn-quiet" onclick={() => (scanning = true)}
						>Scan a QR code</button
					>
				{/if}
			{/if}
		{/if}
		{#if inputError}
			<p class="error" id="join-error" role="alert">{inputError}</p>
		{/if}
	</section>
{/snippet}

<main>
	<a class="back" href={resolve('/settings')}>← Settings</a>
	<div class="title">
		<h1>Link a device</h1>
		<SyncIndicator />
	</div>
	<p class="muted">
		Your library syncs between devices through the sync server. Link a phone and a computer to see
		the same tunes on both.
	</p>

	{#if fromLink}
		{@render joinSection()}
		{@render showSection()}
	{:else}
		{@render showSection()}
		{@render joinSection()}
	{/if}
</main>

<style>
	main {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-4);
		max-width: 40rem;
		margin: 0 auto;
		padding: var(--space-3);
		padding-bottom: calc(var(--space-4) * 2 + env(safe-area-inset-bottom));
	}

	.back {
		display: inline-flex;
		align-items: center;
		min-height: var(--touch);
		text-decoration: none;
		font-weight: 600;
	}

	.title {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		flex-wrap: wrap;
	}

	h1 {
		margin: 0;
	}

	main > p {
		margin: 0;
	}

	h2 {
		margin: 0 0 var(--space-2);
		font-size: 1.0625rem;
	}

	section {
		display: grid;
		gap: var(--space-2);
		justify-items: start;
	}

	section > *,
	.confirm > * {
		max-width: 100%;
	}

	section p {
		margin: 0;
	}

	.small {
		font-size: 0.875rem;
	}

	.copyable {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		width: 100%;
	}

	.copyable code,
	.address {
		flex: 1;
		min-width: 0;
		padding: var(--space-2);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: calc(var(--radius) * 0.75);
	}

	.copyable button {
		flex: none;
	}

	details {
		width: 100%;
	}

	summary {
		min-height: var(--touch);
		display: flex;
		align-items: center;
		cursor: pointer;
		color: var(--color-muted);
	}

	.paste {
		display: grid;
		gap: var(--space-1);
		width: 100%;
	}

	.paste label {
		font-weight: 600;
	}

	.row {
		display: flex;
		gap: var(--space-2);
	}

	.row input {
		flex: 1;
		min-width: 0;
	}

	.confirm {
		display: grid;
		gap: var(--space-2);
		width: 100%;
		padding: var(--space-3);
		background: var(--color-surface);
		border: 1px solid var(--color-accent);
		border-radius: var(--radius);
	}

	.address {
		display: block;
	}

	.warning {
		padding-left: var(--space-2);
		border-left: 3px solid var(--color-star);
	}

	.check {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-height: var(--touch);
	}

	.buttons {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.waiting {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.spinner {
		width: 1.25rem;
		height: 1.25rem;
		border: 2px solid var(--color-accent-soft);
		border-top-color: var(--color-accent);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(1turn);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.spinner {
			animation-duration: 2.4s;
		}
	}

	.error {
		color: var(--color-danger);
	}
</style>
