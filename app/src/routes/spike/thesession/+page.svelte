<script lang="ts">
	import { onMount } from 'svelte';
	import {
		TheSessionClient,
		firstBars,
		parseKey,
		type SearchResults,
		type Tune,
		type TuneRecordings,
		type TuneSets
	} from '#lib/integrations/thesession.ts';

	const client = new TheSessionClient();

	let q = $state('cooley');
	let results = $state.raw<SearchResults>();
	let tune = $state.raw<Tune>();
	let sets = $state.raw<TuneSets>();
	let recordings = $state.raw<TuneRecordings>();
	let error = $state('');
	let smoke = $state<'idle' | 'running' | 'pass' | 'fail'>('idle');
	let smokeLog = $state<string[]>([]);

	async function search() {
		error = '';
		try {
			results = await client.search(q);
		} catch (e) {
			error = String(e);
		}
	}

	async function open(id: number) {
		error = '';
		try {
			[tune, sets, recordings] = await Promise.all([
				client.tune(id),
				client.tuneSets(id),
				client.tuneRecordings(id)
			]);
		} catch (e) {
			error = String(e);
		}
	}

	// One request per endpoint, for the headless CORS check.
	async function runSmoke() {
		smoke = 'running';
		smokeLog = [];
		const steps: [string, () => Promise<string>][] = [
			['search', async () => `${(await client.search('cooley', { perpage: 3 })).total} hits`],
			['tune', async () => `${(await client.tune(1)).settings.length} settings`],
			['sets', async () => `${(await client.tuneSets(1)).total} sets`],
			['recordings', async () => `${(await client.tuneRecordings(1)).recordings.length} recs`]
		];
		let ok = true;
		for (const [name, run] of steps) {
			const t0 = performance.now();
			try {
				const msg = await run();
				smokeLog.push(`ok ${name}: ${msg} (${Math.round(performance.now() - t0)} ms)`);
			} catch (e) {
				ok = false;
				smokeLog.push(`FAIL ${name}: ${e}`);
			}
		}
		smoke = ok ? 'pass' : 'fail';
	}

	onMount(() => {
		if (new URLSearchParams(location.search).has('smoke')) runSmoke();
	});
</script>

<h1>thesession.org</h1>

<div class="row">
	<button onclick={runSmoke}>Run smoke test (4 requests)</button>
	<span data-testid="smoke" data-status={smoke} class={smoke === 'fail' ? 'err' : 'ok'}
		>{smoke}</span
	>
</div>
{#if smokeLog.length}<pre>{smokeLog.join('\n')}</pre>{/if}

<form
	class="row"
	onsubmit={(e) => {
		e.preventDefault();
		search();
	}}
>
	<input bind:value={q} placeholder="Tune name" />
	<button>Search</button>
</form>

{#if error}<p class="err">{error}</p>{/if}

{#if results}
	<p>{results.total} results (page {results.page}/{results.pages})</p>
	<ul>
		{#each results.tunes as t (t.id)}
			<li><button onclick={() => open(t.id)}>{t.name}</button> {t.type} #{t.id}</li>
		{/each}
	</ul>
{/if}

{#if tune}
	<h2>{tune.name} <small>({tune.type})</small></h2>
	<p>Aliases: {tune.aliases.join(', ')}</p>
	<p>{tune.tunebooks} tunebooks · {tune.recordings} recordings</p>
	<h3>Settings ({tune.settings.length})</h3>
	<table>
		<thead><tr><th>id</th><th>key</th><th>parsed</th><th>first bars</th></tr></thead>
		<tbody>
			{#each tune.settings.slice(0, 10) as s (s.id)}
				{@const k = parseKey(s.key)}
				<tr>
					<td>{s.id}</td>
					<td>{s.key}</td>
					<td>{k ? `${k.tonic} ${k.mode}` : '?'}</td>
					<td><code>{firstBars(s.abc)}</code></td>
				</tr>
			{/each}
		</tbody>
	</table>
{/if}

{#if sets}
	<h3>Appears in {sets.total} sets (first {sets.sets.length})</h3>
	<ul>
		{#each sets.sets as s (s.id)}
			<li>
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
				<a href={s.url} target="_blank" rel="noreferrer">#{s.id}</a>
				{s.tunes
					.slice(0, 5)
					.map((t) => `${t.name} (${t.key})`)
					.join(' / ')}{s.tunes.length > 5 ? ' …' : ''}
			</li>
		{/each}
	</ul>
{/if}

{#if recordings}
	<h3>{recordings.recordings.length} recordings</h3>
	<p>
		Often recorded with: {recordings.recordedWith
			.slice(0, 5)
			.map((t) => `${t.name} ×${t.count}`)
			.join(', ')}
	</p>
{/if}
