<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import type { ResolvedPathname } from '$app/types';
	import { library, type ImportResult } from '#lib/store/library.svelte.ts';
	import { previousLibraryUrls } from '#lib/store/repo.ts';
	import { theSession } from '#lib/store/thesession.svelte.ts';
	import { isLocalOnly } from '#lib/domain/providers.ts';
	import { audioFiles } from '#lib/store/audio.svelte.ts';
	import { gdrive } from '#lib/store/gdrive.svelte.ts';
	import { oembed } from '#lib/store/oembed.svelte.ts';
	import SyncIndicator from '#lib/ui/SyncIndicator.svelte';
	import { ui } from '#lib/ui/state.svelte.ts';

	let usage = $state<{ used: number; quota: number }>();
	let persisted = $state<boolean>();
	let copied = $state(false);

	let file = $state<File>();
	let importing = $state(false);
	let importResult = $state<ImportResult>();
	let importError = $state<string>();
	let fileInput: HTMLInputElement;

	const pieceCount = $derived(library.index?.live.length ?? 0);
	// The link-device page, with the old library in the hash as if from a scanned QR code.
	const switchBackHref = (url: string) => `${resolve('/link-device')}#${url}` as ResolvedPathname;
	// Re-read when the active library changes, i.e. after linking to another one.
	const previous = $derived(library.url ? previousLibraryUrls() : []);

	async function refreshStorage() {
		const storage = navigator.storage;
		if (!storage) return;
		const estimate = await storage.estimate?.();
		if (estimate) usage = { used: estimate.usage ?? 0, quota: estimate.quota ?? 0 };
		persisted = await storage.persisted?.();
	}

	let cachedEntries = $state<number>();
	let clearing = $state(false);

	async function refreshCache() {
		cachedEntries = await theSession.entryCount().catch(() => undefined);
	}

	async function clearCache() {
		clearing = true;
		try {
			await theSession.clear();
			oembed.reset();
		} finally {
			clearing = false;
		}
		await Promise.all([refreshCache(), refreshStorage()]);
	}

	let clearingAudio = $state(false);

	/** Drops downloaded recordings not kept offline. Uploads that exist nowhere else stay. */
	async function clearAudio() {
		clearingAudio = true;
		try {
			const sources = library.doc?.sources ?? {};
			const freed = await audioFiles.clearUnkept((id) => {
				const source = sources[id as keyof typeof sources];
				// Unknown ids are shared files still in the inbox, or not synced yet: keep them.
				return !source || isLocalOnly(source);
			});
			ui.showToast(`Freed ${bytes(freed)}`);
		} finally {
			clearingAudio = false;
		}
		await refreshStorage();
	}

	async function connectDrive() {
		try {
			await gdrive.connect();
		} catch (e) {
			ui.showToast(`Google Drive: ${e instanceof Error ? e.message : e}`);
		}
	}

	onMount(() => {
		refreshStorage();
		refreshCache();
		void audioFiles.refresh();
	});

	function bytes(n: number) {
		const units = ['B', 'KB', 'MB', 'GB', 'TB'];
		let i = 0;
		while (n >= 1024 && i < units.length - 1) {
			n /= 1024;
			i++;
		}
		return `${n.toFixed(i === 0 || n >= 10 ? 0 : 1)} ${units[i]}`;
	}

	function stamp() {
		return new Date().toISOString().slice(0, 10);
	}

	function download(data: BlobPart, type: string, name: string) {
		const url = URL.createObjectURL(new Blob([data], { type }));
		const a = document.createElement('a');
		a.href = url;
		a.download = name;
		a.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}

	function exportBinary() {
		download(
			library.exportBinary() as Uint8Array<ArrayBuffer>,
			'application/octet-stream',
			`tunejournal-${stamp()}.automerge`
		);
	}

	function exportJson() {
		download(library.exportJson(), 'application/json', `tunejournal-${stamp()}.json`);
	}

	async function copyUrl() {
		if (!library.url) return;
		await navigator.clipboard.writeText(library.url);
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}

	function choose(e: Event) {
		file = (e.currentTarget as HTMLInputElement).files?.[0];
		importResult = undefined;
		importError = undefined;
	}

	function cancelImport() {
		file = undefined;
		fileInput.value = '';
	}

	async function confirmImport() {
		if (!file) return;
		importing = true;
		try {
			importResult = library.importBinary(new Uint8Array(await file.arrayBuffer()));
			cancelImport();
			refreshStorage();
		} catch (e) {
			console.error('Import failed', e);
			importError = e instanceof Error ? e.message : String(e);
		} finally {
			importing = false;
		}
	}
</script>

<main>
	<a class="back" href={resolve('/(main)')}>← All pieces</a>
	<h1>Settings</h1>

	<section>
		<h2>Library</h2>
		{#if library.status === 'ready'}
			<p>{pieceCount} {pieceCount === 1 ? 'piece' : 'pieces'}</p>
			<div class="url">
				<code data-testid="library-url">{library.url}</code>
				<button type="button" class="btn-quiet" onclick={copyUrl}
					>{copied ? 'Copied' : 'Copy'}</button
				>
			</div>
			<p class="muted small">
				This address opens your library on another device. Anyone who has it can read and change
				your library, so keep it private.
			</p>
			<p><a class="btn-link" href={resolve('/link-device')}>Link a device</a></p>
		{:else}
			<p class="muted">Loading library…</p>
		{/if}
		{#if previous.length > 0}
			<details class="previous">
				<summary>Libraries this device showed before</summary>
				<p class="muted small">
					They’re still saved on this device. Switching back works like linking to them.
				</p>
				<ul>
					{#each previous as url (url)}
						<li>
							<code>{url}</code>
							<a href={switchBackHref(url)}>Switch back</a>
						</li>
					{/each}
				</ul>
			</details>
		{/if}
	</section>

	<section>
		<h2>Sync</h2>
		<SyncIndicator verbose />
	</section>

	<section>
		<h2>Storage</h2>
		{#if usage}
			<p data-testid="storage-usage">
				Using {bytes(usage.used)}{#if usage.quota}&nbsp;of {bytes(usage.quota)} available{/if}.
			</p>
		{:else}
			<p class="muted">Storage usage isn’t available in this browser.</p>
		{/if}
		{#if audioFiles.usage}
			{@const u = audioFiles.usage}
			<p data-testid="audio-usage">
				Recordings on this device: {u.count}
				{u.count === 1 ? 'file' : 'files'}, {bytes(
					u.bytes
				)}{#if u.keptCount > 0}&nbsp;({u.keptCount}
					kept offline, {bytes(u.keptBytes)}){/if}.
			</p>
			<button
				type="button"
				class="btn-quiet"
				onclick={clearAudio}
				disabled={clearingAudio || u.count === u.keptCount}>Remove downloaded recordings</button
			>
			<p class="muted small">
				Removes recordings downloaded for playing, except those kept offline and uploads that aren’t
				backed up anywhere else. They download again when played.
			</p>
		{/if}
		{#if persisted !== undefined}
			<p class="muted small">
				{persisted
					? 'Storage is persistent: the browser won’t clear it to free up space.'
					: 'Storage isn’t marked persistent yet. The browser may clear it if space runs low, so keep backups.'}
			</p>
		{/if}
	</section>

	{#if gdrive.configured}
		<section>
			<h2>Google Drive</h2>
			<p class="muted small">
				Uploads are backed up to a <code>TuneJournal</code> folder in your Drive, so your other devices
				can play them. TuneJournal only sees files you pick or it created.
			</p>
			{#if gdrive.connected}
				<p>Connected on this device.</p>
				<button type="button" class="btn-quiet" onclick={() => gdrive.disconnect()}
					>Disconnect</button
				>
			{:else}
				<button type="button" onclick={connectDrive}>Connect Google Drive</button>
			{/if}
		</section>
	{/if}

	<section>
		<h2>Cached data</h2>
		<p class="muted small">
			Tune details, sets and searches from thesession.org, and titles of linked videos, are kept on
			this device so they work offline. They aren’t synced, and they’re fetched again when needed.
		</p>
		<p data-testid="cache-count">
			{#if cachedEntries === undefined}
				&nbsp;
			{:else if cachedEntries === 0}
				Nothing cached.
			{:else}
				{cachedEntries} cached {cachedEntries === 1 ? 'response' : 'responses'}.
			{/if}
		</p>
		<button type="button" class="btn-quiet" onclick={clearCache} disabled={clearing}
			>Clear cached data</button
		>
	</section>

	<section>
		<h2>Backup</h2>
		<p class="muted small">
			The <code>.automerge</code> file is a full backup you can import again. The JSON snapshot is for
			reading or for other tools.
		</p>
		<div class="buttons">
			<button type="button" onclick={exportBinary} disabled={library.status !== 'ready'}
				>Export .automerge</button
			>
			<button
				type="button"
				class="btn-quiet"
				onclick={exportJson}
				disabled={library.status !== 'ready'}>Export JSON</button
			>
		</div>
	</section>

	<section>
		<h2>Import</h2>
		<p class="muted small">
			Merges a <code>.automerge</code> backup into this library. Nothing here is removed: a backup of
			this library merges its history, and pieces from another library are added alongside yours.
		</p>
		<label class="file">
			<span>Choose a backup file</span>
			<input
				bind:this={fileInput}
				type="file"
				accept=".automerge,application/octet-stream"
				onchange={choose}
				disabled={library.status !== 'ready'}
			/>
		</label>
		{#if file}
			<div class="confirm" role="group" aria-label="Confirm import">
				<p>Merge <strong>{file.name}</strong> ({bytes(file.size)}) into this library?</p>
				<div class="buttons">
					<button type="button" onclick={confirmImport} disabled={importing}
						>Merge into library</button
					>
					<button type="button" class="btn-quiet" onclick={cancelImport}>Cancel</button>
				</div>
			</div>
		{/if}
		{#if importResult}
			<p role="status">
				{#if importResult.mode === 'merged'}
					Merged the backup into this library.
				{:else}
					Added {importResult.pieces}
					{importResult.pieces === 1 ? 'piece' : 'pieces'} from another library.
				{/if}
			</p>
		{/if}
		{#if importError}
			<p class="error" role="alert">Couldn’t import that file: {importError}</p>
		{/if}
	</section>

	<section>
		<h2>Developer</h2>
		<p><a href={resolve('/spike')}>Integration spikes</a></p>
	</section>
</main>

<style>
	main {
		display: grid;
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

	h1 {
		margin: 0;
	}

	h2 {
		margin: 0 0 var(--space-2);
		font-size: 1.0625rem;
	}

	section p {
		margin: 0 0 var(--space-2);
	}

	.small {
		font-size: 0.875rem;
	}

	.url {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin-bottom: var(--space-2);
	}

	.url code {
		flex: 1;
		min-width: 0;
		padding: var(--space-2);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: calc(var(--radius) * 0.75);
	}

	.btn-link {
		display: inline-grid;
		place-items: center;
		min-height: var(--touch);
		padding: 0 var(--space-3);
		border-radius: var(--radius);
		background: var(--color-accent);
		color: var(--color-on-accent);
		text-decoration: none;
	}

	.previous summary {
		min-height: var(--touch);
		display: flex;
		align-items: center;
		cursor: pointer;
	}

	.previous ul {
		display: grid;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.previous li {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.previous code {
		flex: 1;
		min-width: 0;
	}

	.buttons {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.file {
		display: grid;
		gap: var(--space-1);
		font-weight: 600;
	}

	.file input {
		padding: var(--space-2);
		font-weight: 400;
	}

	.confirm {
		margin-top: var(--space-3);
		padding: var(--space-3);
		background: var(--color-surface);
		border: 1px solid var(--color-accent);
		border-radius: var(--radius);
	}

	.error {
		color: var(--color-danger);
	}
</style>
