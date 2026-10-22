<!--
	Settings → Google Drive: the Google Cloud settings Drive needs (OAuth client ID, API key, project
	number), saved on this device only and never synced; they override the ones built into the app.
	Shows this origin for the OAuth client's allow-list, tests the connection, and connects or
	disconnects this device.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { configProblems } from '#lib/integrations/gdrive.ts';
	import { gdrive } from '#lib/store/gdrive.svelte.ts';
	import { ui } from './state.svelte.ts';

	const uid = $props.id();

	let clientId = $state('');
	let apiKey = $state('');
	let appId = $state('');
	let origin = $state('');
	let testing = $state(false);
	let test = $state<{ ok: boolean; message: string }>();
	let editing = $state(false);

	const typed = $derived({ clientId, apiKey, appId });
	const problems = $derived(configProblems(typed));
	const dirty = $derived(
		clientId.trim() !== (gdrive.device.clientId ?? '') ||
			apiKey.trim() !== (gdrive.device.apiKey ?? '') ||
			appId.trim() !== (gdrive.device.appId ?? '')
	);

	function load() {
		clientId = gdrive.device.clientId ?? '';
		apiKey = gdrive.device.apiKey ?? '';
		appId = gdrive.device.appId ?? '';
	}

	onMount(() => {
		origin = location.origin;
		load();
		// Open the form straight away when there's nothing to use yet.
		editing = !gdrive.configured;
	});

	function save(e: SubmitEvent) {
		e.preventDefault();
		test = undefined;
		try {
			gdrive.saveDeviceConfig(typed);
			load();
			ui.showToast(
				gdrive.configured ? 'Google Drive settings saved' : 'Saved; some are still missing'
			);
			if (gdrive.configured) editing = false;
		} catch (err) {
			ui.showToast(err instanceof Error ? err.message : String(err));
		}
	}

	function clear() {
		gdrive.clearDeviceConfig();
		load();
		test = undefined;
		ui.showToast('Removed the settings saved on this device');
	}

	async function runTest() {
		testing = true;
		test = undefined;
		try {
			await gdrive.test();
			test = { ok: true, message: 'It works: signed in, and Google Drive answered.' };
		} catch (err) {
			test = { ok: false, message: err instanceof Error ? err.message : String(err) };
		} finally {
			testing = false;
		}
	}

	async function connect() {
		try {
			await gdrive.connect();
		} catch (err) {
			ui.showToast(`Google Drive: ${err instanceof Error ? err.message : err}`);
		}
	}
</script>

<section aria-labelledby="{uid}-heading" data-testid="drive-settings">
	<h2 id="{uid}-heading">Google Drive</h2>
	<p class="muted small">
		Uploads are backed up to a <code>TuneJournal</code> folder in your Drive, so your other devices can
		play them. TuneJournal only sees files you pick or it created.
	</p>

	<p data-testid="drive-status">
		{#if gdrive.origin === 'device'}
			Set up with settings saved on this device.
		{:else if gdrive.origin === 'build'}
			Set up with the settings built into this app.
		{:else}
			Not set up yet. Paste your Google Cloud settings below.
		{/if}
	</p>

	{#if gdrive.configured}
		<div class="buttons">
			{#if gdrive.connected}
				<span class="connected">Connected on this device.</span>
				<button type="button" class="btn-quiet" onclick={() => gdrive.disconnect()}
					>Disconnect</button
				>
			{:else}
				<button type="button" onclick={connect}>Connect Google Drive</button>
			{/if}
			<button type="button" class="btn-quiet" onclick={runTest} disabled={testing}
				>{testing ? 'Testing…' : 'Test connection'}</button
			>
		</div>
		{#if test}
			<p class:error={!test.ok} role={test.ok ? 'status' : 'alert'} data-testid="drive-test">
				{test.message}
			</p>
		{/if}
	{/if}

	{#if editing}
		<form class="config" onsubmit={save}>
			<p class="muted small">
				From your Google Cloud project: an OAuth client ID (type “Web application”), an API key that
				can use the Picker API, and the project number. They’re saved on this device only, never
				synced{gdrive.build.clientId ? ', and take the place of the ones built into this app' : ''}.
			</p>
			<div class="field">
				<label for="{uid}-client">OAuth client ID</label>
				<input
					id="{uid}-client"
					type="text"
					autocomplete="off"
					spellcheck="false"
					placeholder={gdrive.build.clientId || '1234-abc.apps.googleusercontent.com'}
					bind:value={clientId}
				/>
			</div>
			<div class="field">
				<label for="{uid}-key">API key</label>
				<input
					id="{uid}-key"
					type="text"
					autocomplete="off"
					spellcheck="false"
					placeholder={gdrive.build.apiKey || 'AIza…'}
					bind:value={apiKey}
				/>
			</div>
			<div class="field">
				<label for="{uid}-app">App ID (project number)</label>
				<input
					id="{uid}-app"
					type="text"
					inputmode="numeric"
					autocomplete="off"
					spellcheck="false"
					placeholder={gdrive.build.appId || '123456789012'}
					bind:value={appId}
				/>
			</div>
			{#each problems as problem (problem)}<p class="warn small">{problem}</p>{/each}
			<p class="small">
				Add this origin to your OAuth client’s <strong>Authorized JavaScript origins</strong>:
				<code data-testid="drive-origin">{origin}</code>
			</p>
			<div class="buttons">
				<button type="submit" disabled={!dirty}>Save</button>
				{#if gdrive.origin === 'device' || Object.keys(gdrive.device).length > 0}
					<button type="button" class="btn-quiet" onclick={clear}>Remove saved settings</button>
				{/if}
				{#if gdrive.configured}
					<button
						type="button"
						class="btn-quiet"
						onclick={() => {
							load();
							editing = false;
						}}>Cancel</button
					>
				{/if}
			</div>
		</form>
	{:else}
		<button type="button" class="btn-quiet change" onclick={() => (editing = true)}
			>Change Google Cloud settings…</button
		>
	{/if}
</section>

<style>
	section p {
		margin: 0 0 var(--space-2);
	}

	h2 {
		margin: 0 0 var(--space-2);
		font-size: 1.0625rem;
	}

	.small {
		font-size: 0.875rem;
	}

	.buttons {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		margin-bottom: var(--space-2);
	}

	.config {
		display: grid;
		gap: var(--space-2);
		margin-top: var(--space-2);
		padding: var(--space-3);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
	}

	.config p {
		margin: 0;
	}

	.field {
		display: grid;
		gap: var(--space-1);
	}

	label {
		font-weight: 600;
	}

	input {
		font-family: var(--font-mono);
		font-size: 0.875rem;
	}

	code {
		overflow-wrap: anywhere;
	}

	.warn {
		color: var(--color-star);
	}

	.error {
		color: var(--color-danger);
	}

	.change {
		margin-top: var(--space-1);
	}
</style>
