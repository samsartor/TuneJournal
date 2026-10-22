<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { Repo, isValidAutomergeUrl, type DocHandle } from '@automerge/automerge-repo';
	import { IndexedDBStorageAdapter } from '@automerge/automerge-repo-storage-indexeddb';
	import { BrowserWebSocketClientAdapter } from '@automerge/automerge-repo-network-websocket';

	interface Ping {
		count: number;
		sentAt: number;
		by: string;
	}

	// A separate repo and database from the real library, so this can't touch user data.
	const repo = new Repo({
		storage: new IndexedDBStorageAdapter('tunejournal-spike-sync'),
		network: [new BrowserWebSocketClientAdapter('wss://sync.automerge.org')]
	});
	const me = Math.random().toString(36).slice(2, 8);

	let handle = $state.raw<DocHandle<Ping>>();
	let doc = $state.raw<Ping>();
	let peers = $state(0);
	let latencies = $state<number[]>([]);
	let error = $state('');

	repo.networkSubsystem.on('peer', () => peers++);
	repo.networkSubsystem.on('peer-disconnected', () => peers--);

	function attach(h: DocHandle<Ping>) {
		handle = h;
		doc = h.doc();
		h.on('change', ({ doc: d }) => {
			doc = d;
			if (d.by !== me) latencies.push(Date.now() - d.sentAt);
		});
	}

	function create() {
		const h = repo.create<Ping>({ count: 0, sentAt: Date.now(), by: me });
		attach(h);
		history.replaceState(null, '', `?doc=${encodeURIComponent(h.url)}`);
	}

	function bump() {
		handle?.change((d) => {
			d.count++;
			d.sentAt = Date.now();
			d.by = me;
		});
	}

	onMount(async () => {
		const url = new URLSearchParams(location.search).get('doc');
		if (!isValidAutomergeUrl(url)) return;
		try {
			attach(await repo.find<Ping>(url));
		} catch (e) {
			error = String(e);
		}
	});

	onDestroy(() => repo.shutdown());

	const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
</script>

<h1>Automerge sync</h1>
<p>
	Open this page in two browsers (or a normal and a private window). Create a doc in one, copy the
	URL into the other, then bump. Latency uses both machines' clocks, so it's only meaningful on the
	same machine.
</p>

<p>me={me} · relay peers: <span data-testid="peers">{peers}</span></p>
{#if error}<p class="err">{error}</p>{/if}

{#if !handle}
	<button onclick={create} data-testid="create">Create doc</button>
{:else}
	<p>Doc: <code data-testid="url">{handle.url}</code></p>
	<p>
		count = <b data-testid="count">{doc?.count}</b> (last by {doc?.by === me ? 'me' : doc?.by})
	</p>
	<button onclick={bump} data-testid="bump">Bump</button>
	{#if latencies.length}
		<p>
			Received {latencies.length} remote changes; latency ms: last
			<b data-testid="latency">{latencies.at(-1)}</b>, median {median(latencies)}, all
			{latencies.join(', ')}
		</p>
	{/if}
{/if}
