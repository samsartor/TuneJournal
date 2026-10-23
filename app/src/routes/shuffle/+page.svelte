<!--
	Shuffle (PLAN.md §6.5): full-screen flashcards on every width. One piece at a time, in the
	session's order from domain/shuffle.ts (Gumbel-top-k, seeded). The session lives in the URL,
	/shuffle?seed=…&at=…&i=…, kept up to date with replaceState, so a reload or a trip to a piece's
	details and back lands on the same card, and Back leaves Shuffle. "Practiced" logs practice and
	moves on; "Skip" moves on without logging anything. The skill slider saves as you move it (an
	explicit edit), and a practice entry records it as `skillAfter` when it changed.
-->
<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { player } from '#lib/audio/player.svelte.ts';
	import { hasKey } from '#lib/domain/derived.ts';
	import { relativeTime, untitled } from '#lib/domain/format.ts';
	import { formatKey } from '#lib/domain/key.ts';
	import { logPractice, updatePiece } from '#lib/domain/ops.ts';
	import {
		newSeed,
		parseSession,
		sessionOrder,
		sessionQuery,
		shuffleCandidates,
		shuffleFingerprint,
		type ShuffleSession
	} from '#lib/domain/shuffle.ts';
	import type { PieceId, Skill } from '#lib/domain/types.ts';
	import { library } from '#lib/store/library.svelte.ts';
	import KindBadge from '#lib/ui/KindBadge.svelte';
	import ShufflePlayer from '#lib/ui/ShufflePlayer.svelte';
	import ShuffleSettings from '#lib/ui/ShuffleSettings.svelte';
	import SkillSlider from '#lib/ui/SkillSlider.svelte';
	import { loadSnapshot, saveSnapshot, type ShuffleSnapshot } from '#lib/ui/shuffleSession.ts';
	import { ui } from '#lib/ui/state.svelte.ts';

	const index = $derived(library.index);
	const settings = $derived(library.doc?.settings.shuffle);
	const list = $derived(library.doc?.settings.list);
	const fingerprint = $derived(settings ? shuffleFingerprint(settings, list) : undefined);

	function freshSession(): ShuffleSession {
		return { seed: newSeed(), at: Date.now(), i: 0 };
	}

	/** Seed, start and position, from the URL on entry (a new session when they're missing). */
	let session = $state<ShuffleSession>(
		untrack(() => parseSession(page.url.searchParams)) ?? freshSession()
	);
	/** The session's order, built once and then kept as is (see shuffleSession.ts). */
	let snapshot = $state.raw<ShuffleSnapshot>();
	let settingsOpen = $state(false);
	let playerUi = $state<ShufflePlayer>();

	const href = $derived(`${resolve('/shuffle')}?${sessionQuery(session)}`);

	// Keep the URL in step without adding history entries, so Back leaves Shuffle.
	$effect(() => {
		const target = href;
		if (location.pathname + location.search === target) return;
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- resolve('/shuffle') plus a query
		void goto(target, { replace: true, shallow: true, reset: false });
	});

	// Build the order once the library is open; settings changed mid-session start a new shuffle.
	$effect(() => {
		if (!index || !settings || fingerprint === undefined) return;
		const fp = fingerprint;
		untrack(() => {
			if (snapshot?.fingerprint === fp) return;
			if (snapshot) reshuffle();
			else build(loadSnapshot(session.seed, session.at, fp));
		});
	});

	function build(saved?: ShuffleSnapshot) {
		if (!index || !settings || fingerprint === undefined) return;
		const { seed, at } = session;
		snapshot = saved ?? {
			seed,
			at,
			fingerprint,
			ids: sessionOrder(index, settings, { seed, at, list })
		};
		saveSnapshot(snapshot);
	}

	function reshuffle() {
		player.close();
		session = freshSession();
		build();
	}

	const order = $derived(snapshot?.ids);
	const currentId = $derived<PieceId | undefined>(order?.[session.i]);
	const piece = $derived(currentId ? index?.get(currentId) : undefined);
	// Everything that matches the settings now: for the live count and the empty states.
	const matching = $derived(
		index && settings ? shuffleCandidates(index, settings, { list, at: ui.now }) : []
	);
	// Not counting the card that's up.
	const remaining = $derived(order ? Math.max(0, order.length - session.i - 1) : 0);

	// An empty session, but something matches now (synced in after it started, say): start over.
	$effect(() => {
		if (order?.length === 0 && matching.length > 0) untrack(reshuffle);
	});

	// The piece was deleted or merged away (on another device, say): move on.
	$effect(() => {
		if (currentId && index && (!piece || piece.deletedAt || piece.mergedInto)) untrack(advance);
	});

	// Remember the piece's own skill when its card comes up, to tell whether the slider moved.
	$effect(() => {
		const id = currentId;
		const skill = piece?.skill;
		untrack(() => {
			if (!id || !snapshot || snapshot.card?.id === id) return;
			snapshot = { ...snapshot, card: skill === undefined ? { id } : { id, skill } };
			saveSnapshot(snapshot);
		});
	});

	function advance() {
		player.close();
		session = { ...session, i: session.i + 1 };
	}

	function practiced() {
		const p = piece;
		if (!p) return;
		const skill = p.skill;
		const atStart = snapshot?.card?.id === p.id ? snapshot.card.skill : skill;
		const changed = skill !== atStart && skill !== undefined;
		library.change((d) =>
			logPractice(d, p.id, { via: 'shuffle', ...(changed ? { skillAfter: skill } : {}) })
		);
		ui.now = Date.now();
		advance();
	}

	function setSkill(skill: Skill | null) {
		const id = currentId;
		if (id) library.change((d) => updatePiece(d, id, { skill }));
	}

	function openDetails() {
		if (piece) ui.shuffleReturn = { id: piece.id, href };
	}

	function onkeydown(e: KeyboardEvent) {
		if (settingsOpen || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
		const target = e.target as HTMLElement | null;
		if (target?.closest('input, select, textarea, button, a, [contenteditable], dialog')) return;
		if (!piece) return;
		if (e.key === ' ') {
			e.preventDefault();
			playerUi?.toggle();
		} else if (e.key === 'p' || e.key === 'P') {
			practiced();
		} else if (e.key === 's' || e.key === 'S') {
			advance();
		}
	}

	// Leaving Shuffle stops its player; the mini-player bar takes over again elsewhere.
	onDestroy(() => player.close());

	const name = $derived(piece ? (piece.title ?? untitled(piece.kind)) : '');
	// Effective values (§5): a recording's, or a Part's Tune's key, when the piece has none.
	const key = $derived(piece && index ? index.effectiveKey(piece) : undefined);
	const firstNotes = $derived(piece && index ? index.effectiveFirstNotes(piece) : undefined);
	const tags = $derived(piece && index ? index.tagsOf(piece) : []);
	const stats = $derived(piece && index ? index.stats(piece) : undefined);
	const tune = $derived(piece && index ? index.inheritsFrom(piece) : undefined);
	const tuneName = $derived(tune ? (tune.title ?? untitled(tune.kind)) : '');
</script>

<svelte:window {onkeydown} />

<svelte:head><title>Shuffle · TuneJournal</title></svelte:head>

<div class="shuffle">
	<header class="top">
		<button
			type="button"
			class="icon-btn"
			aria-label="Shuffle settings"
			title="Shuffle settings"
			onclick={() => (settingsOpen = true)}>⚙</button
		>
		<h1>
			Shuffle
			{#if piece && order}<span class="position" data-testid="shuffle-position"
					>{session.i + 1} of {order.length}</span
				>{/if}
		</h1>
		<div class="top-actions">
			{#if piece}
				<button
					type="button"
					class="icon-btn"
					aria-label="Reshuffle"
					title="Reshuffle: a new order from the start"
					onclick={reshuffle}>⤮</button
				>
			{/if}
			<a class="icon-btn close" href={resolve('/(main)')} aria-label="Close shuffle" title="Close"
				>✕</a
			>
		</div>
	</header>

	{#if library.status === 'error'}
		<div class="empty"><p>Couldn’t open the library: {String(library.error)}</p></div>
	{:else if !index || !settings || !order}
		<div class="empty"><p class="muted">Loading library…</p></div>
	{:else if piece}
		{#key piece.id}
			<main class="card" aria-labelledby="shuffle-title" data-testid="shuffle-card">
				<div class="piece">
					<div class="head">
						<KindBadge kind={piece.kind} />
						{#if piece.favorite}<span class="star" aria-label="Favorite" role="img">★</span>{/if}
					</div>
					<h2 id="shuffle-title" class:muted={!piece.title}>{name}</h2>
					{#if hasKey(piece) && (key || firstNotes)}
						<p class="facts">
							{#if key}<span class="key" data-testid="shuffle-key">{formatKey(key)}</span>{/if}
							{#if firstNotes}<span class="abc" aria-label="First notes">{firstNotes}</span>{/if}
						</p>
					{/if}
					{#if tags.length > 0}
						<ul class="tags" aria-label="Tags">
							{#each tags as tag (tag)}<li class="chip">{tag}</li>{/each}
						</ul>
					{/if}
					<p class="last muted" data-testid="last-practiced">
						{stats?.lastPracticed === undefined
							? 'Never practiced'
							: `Last practiced ${relativeTime(stats.lastPracticed, ui.now)}`}
					</p>
					<a
						class="details"
						href={resolve('/(main)/piece/[id]', { id: piece.id })}
						onclick={openDetails}>Open details</a
					>
				</div>

				<ShufflePlayer bind:this={playerUi} {piece} {index} />
			</main>

			<footer class="actions">
				<div class="skill">
					<SkillSlider
						id="shuffle-skill"
						skill={piece.skill}
						inherited={tune ? { skill: tune.skill, from: tuneName } : undefined}
						onchange={setSkill}
					/>
				</div>
				<div class="buttons">
					<button type="button" class="btn-quiet skip" onclick={advance}>
						Skip <span aria-hidden="true">→</span>
					</button>
					<button type="button" class="practiced" onclick={practiced}>
						Practiced <span aria-hidden="true">→</span>
					</button>
				</div>
				<p class="hint muted" aria-hidden="true">
					Keys: <kbd>Space</kbd> play · <kbd>P</kbd> practiced · <kbd>S</kbd> skip
				</p>
			</footer>
		{/key}
	{:else if order.length === 0}
		<div class="empty" role="status">
			<p class="big" aria-hidden="true">⤮</p>
			<h2>Nothing to shuffle</h2>
			<p class="muted">
				{index.live.length === 0
					? 'Add some tunes first.'
					: 'No pieces match the shuffle settings.'}
			</p>
			{#if index.live.length > 0}
				<button type="button" onclick={() => (settingsOpen = true)}>Change settings</button>
			{:else}
				<a class="btn-link" href={resolve('/(main)')}>Back to the list</a>
			{/if}
		</div>
	{:else}
		<div class="empty" role="status">
			<h2>You’ve been through everything 🎉</h2>
			<p class="muted">
				{order.length}
				{order.length === 1 ? 'piece' : 'pieces'} this round.
			</p>
			<div class="empty-actions">
				<button type="button" onclick={reshuffle}>Reshuffle</button>
				<a class="btn-link btn-quiet" href={resolve('/(main)')}>Done</a>
			</div>
		</div>
	{/if}
</div>

{#if settings}
	<ShuffleSettings bind:open={settingsOpen} {settings} matching={matching.length} {remaining} />
{/if}

<style>
	.shuffle {
		display: grid;
		grid-template-rows: auto 1fr auto;
		grid-template-columns: minmax(0, 1fr);
		min-height: 100dvh;
		max-width: 40rem;
		margin: 0 auto;
	}

	.top {
		position: sticky;
		top: 0;
		z-index: 5;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		padding: var(--space-1) var(--space-2);
		background: var(--color-bg);
	}

	.top h1 {
		margin: 0;
		font-size: 1rem;
		font-weight: 600;
		color: var(--color-muted);
	}

	.position {
		margin-left: var(--space-1);
		font-weight: 400;
		font-variant-numeric: tabular-nums;
	}

	.top-actions {
		display: flex;
		gap: var(--space-1);
	}

	.close {
		text-decoration: none;
	}

	.card {
		display: grid;
		gap: var(--space-3);
		align-content: start;
		padding: 0 var(--space-3) var(--space-3);
	}

	.piece {
		display: grid;
		gap: var(--space-2);
		justify-items: center;
		text-align: center;
		padding-top: var(--space-2);
	}

	.head {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.star {
		color: var(--color-star);
		font-size: 1.25rem;
		line-height: 1;
	}

	h2 {
		margin: 0;
		font-size: 1.75rem;
		line-height: 1.2;
		overflow-wrap: anywhere;
	}

	h2.muted {
		font-style: italic;
		font-weight: 500;
	}

	.facts {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		align-items: baseline;
		gap: var(--space-1) var(--space-3);
		margin: 0;
	}

	.key {
		font-size: 1.125rem;
		font-weight: 700;
	}

	.abc {
		font-family: var(--font-mono);
		overflow-wrap: anywhere;
	}

	.tags {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: var(--space-1);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.last {
		margin: 0;
		font-size: 0.9375rem;
	}

	.details {
		display: inline-flex;
		align-items: center;
		min-height: var(--touch);
		font-weight: 600;
	}

	/* The skill slider and the two big buttons stay within thumb reach at the bottom. */
	.actions {
		position: sticky;
		bottom: 0;
		z-index: 5;
		display: grid;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3) calc(var(--space-3) + env(safe-area-inset-bottom));
		background: var(--color-bg);
		border-top: 1px solid var(--color-border);
	}

	.buttons {
		display: grid;
		grid-template-columns: 1fr 1.5fr;
		gap: var(--space-2);
	}

	.buttons button {
		min-height: 3.75rem;
		font-size: 1.125rem;
		font-weight: 700;
	}

	.hint {
		display: none;
		margin: 0;
		text-align: center;
		font-size: 0.8125rem;
	}

	kbd {
		font-family: var(--font-mono);
		font-size: 0.75rem;
		padding: 0 0.3rem;
		border: 1px solid var(--color-border);
		border-radius: 0.25rem;
	}

	/* Keyboard hints only where there's probably a keyboard. */
	@media (hover: hover) and (pointer: fine) {
		.hint {
			display: block;
		}
	}

	.empty {
		display: grid;
		place-content: center;
		justify-items: center;
		gap: var(--space-2);
		padding: var(--space-4) var(--space-3);
		text-align: center;
	}

	.empty p,
	.empty h2 {
		margin: 0;
	}

	.empty h2 {
		font-size: 1.375rem;
	}

	.big {
		font-size: 3rem;
		color: var(--color-accent);
	}

	.empty-actions {
		display: flex;
		gap: var(--space-2);
	}

	.btn-link {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: var(--touch);
		padding: 0 var(--space-3);
		border-radius: var(--radius);
		text-decoration: none;
		font-weight: 600;
	}

	.btn-link.btn-quiet {
		color: var(--color-text);
	}

	@media (min-width: 52rem) {
		.card {
			padding-top: var(--space-3);
		}

		h2 {
			font-size: 2rem;
		}
	}
</style>
