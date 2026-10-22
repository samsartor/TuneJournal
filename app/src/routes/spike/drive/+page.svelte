<script lang="ts">
	import {
		PUBLIC_GOOGLE_API_KEY,
		PUBLIC_GOOGLE_APP_ID,
		PUBLIC_GOOGLE_CLIENT_ID
	} from '$app/env/public';
	import {
		download,
		ensureFolder,
		loadGoogle,
		pickAudio,
		requestToken,
		upload,
		type PickedDoc
	} from '#lib/spike/google.ts';
	import { getFile, putFile } from '#lib/spike/file-store.ts';
	import { resolve } from '$app/paths';

	const configured = !!(PUBLIC_GOOGLE_CLIENT_ID && PUBLIC_GOOGLE_API_KEY && PUBLIC_GOOGLE_APP_ID);

	let token = $state<string>();
	let expiresAt = $state(0);
	let picked = $state.raw<PickedDoc>();
	let src = $state<string>();
	let log = $state<string[]>([]);
	let busy = $state(false);
	let uploadInput = $state<HTMLInputElement>();

	function note(msg: string) {
		log.push(`${new Date().toLocaleTimeString()} ${msg}`);
	}

	async function step(name: string, fn: () => Promise<void>) {
		busy = true;
		const t0 = performance.now();
		try {
			await fn();
			note(`ok ${name} (${Math.round(performance.now() - t0)} ms)`);
		} catch (e) {
			note(`FAIL ${name}: ${e instanceof Error ? e.message : e}`);
		} finally {
			busy = false;
		}
	}

	const signIn = () =>
		step('sign in', async () => {
			await loadGoogle();
			const t = await requestToken(PUBLIC_GOOGLE_CLIENT_ID, token ? '' : 'consent');
			token = t.token;
			expiresAt = t.expiresAt;
		});

	const pickAndPlay = () =>
		step('pick + download + OPFS + play', async () => {
			if (!token) throw new Error('Sign in first');
			const doc = await pickAudio({
				token,
				apiKey: PUBLIC_GOOGLE_API_KEY,
				appId: PUBLIC_GOOGLE_APP_ID
			});
			if (!doc) return note('picker cancelled');
			picked = doc;
			note(`picked ${doc.name} (${doc.mimeType}, ${doc.sizeBytes ?? '?'} bytes)`);
			const t0 = performance.now();
			const blob = await download(token, doc.id);
			note(
				`downloaded ${blob.size} bytes, type "${blob.type}" in ${Math.round(performance.now() - t0)} ms`
			);
			const name = `${doc.id}-${doc.name}`;
			const typed = blob.type ? blob : new Blob([blob], { type: doc.mimeType });
			const backend = await putFile('drive', name, typed);
			note(`stored in ${backend} as drive/${name}`);
			const back = await getFile({ dir: 'drive', name, type: typed.type, backend });
			if (src) URL.revokeObjectURL(src);
			src = URL.createObjectURL(back);
		});

	const testUpload = () =>
		step('upload to TuneJournal/', async () => {
			if (!token) throw new Error('Sign in first');
			const folder = await ensureFolder(token);
			note(`folder id ${folder}`);
			const chosen = uploadInput?.files?.[0];
			const file =
				chosen ??
				new Blob([`TuneJournal spike upload ${new Date().toISOString()}\n`], {
					type: 'text/plain'
				});
			const name = chosen?.name ?? `spike-${Date.now()}.txt`;
			const res = await upload(token, folder, file, name);
			note(`uploaded ${res.name} → ${res.webViewLink}`);
		});
</script>

<h1>Google Drive</h1>

{#if !configured}
	<p class="err">
		Missing <code>PUBLIC_GOOGLE_CLIENT_ID</code>, <code>PUBLIC_GOOGLE_API_KEY</code> or
		<code>PUBLIC_GOOGLE_APP_ID</code>. Copy <code>app/.env.example</code> to <code>app/.env</code>,
		fill it in (see <code>spikes/README.md</code>) and restart the dev server.
	</p>
{/if}

<ol>
	<li class="row">
		<button disabled={!configured || busy} onclick={signIn}>Sign in (drive.file)</button>
		{#if token}<span class="ok">token until {new Date(expiresAt).toLocaleTimeString()}</span>{/if}
	</li>
	<li class="row">
		<button disabled={!token || busy} onclick={pickAndPlay}>Pick an audio file</button>
		{#if picked}<span>{picked.name}</span>{/if}
	</li>
	<li class="row">
		<input type="file" bind:this={uploadInput} />
		<button disabled={!token || busy} onclick={testUpload}>Upload to TuneJournal/</button>
		<small>(no file chosen = a small text file)</small>
	</li>
</ol>

{#if src}
	<audio controls {src}></audio>
	<p><a href={resolve('/spike/speed')}>Try it on the speed page</a> (it lists OPFS files).</p>
{/if}

<pre>{log.join('\n') || 'Log'}</pre>
