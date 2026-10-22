<!--
	Shuffle (PLAN.md §6.5): full-screen flashcards on every width. One piece at a time, picked by
	the temperature-weighted sampler in domain/shuffle.ts, with its own player. "Practiced" logs
	practice and moves on; "Skip" moves on without logging anything. The skill slider saves as you
	move it (an explicit edit), and a practice entry records it as `skillAfter` when it changed.
	Pieces shown this session aren't picked again until Restart.
-->
<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { resolve } from '$app/paths';
	import { player } from '#lib/audio/player.svelte.ts';
	import { hasKey } from '#lib/domain/derived.ts';
	import { relativeTime, untitled } from '#lib/domain/format.ts';
	import { formatKey } from '#lib/domain/key.ts';
	import { logPractice, updatePiece } from '#lib/domain/ops.ts';
	import { pickNext, shuffleCandidates } from '#lib/domain/shuffle.ts';
	import type { PieceId, Skill } from '#lib/domain/types.ts';
	import { library } from '#lib/store/library.svelte.ts';
	import KindBadge from '#lib/ui/KindBadge.svelte';
	import ShufflePlayer from '#lib/ui/ShufflePlayer.svelte';
	import ShuffleSettings from '#lib/ui/ShuffleSettings.svelte';
	import SkillSlider from '#lib/ui/SkillSlider.svelte';
	import { ui } from '#lib/ui/state.svelte.ts';

	const index = $derived(library.index);
	const settings = $derived(library.doc?.settings.shuffle);
	const list = $derived(library.doc?.settings.list);

	/** Pieces shown this session, in order. Lives only as long as the view (§6.5). */
	let shown = $state<PieceId[]>([]);
	let currentId = $state<PieceId>();
	/** The piece's own skill when its card came up, to tell whether the slider moved. */
	let skillAtStart: Skill | undefined;
	let started = $state(false);
	let settingsOpen = $state(false);
	let playerUi = $state<ShufflePlayer>();

	const piece = $derived(currentId ? index?.get(currentId) : undefined);
	// Everything that matches the settings, shown or not: for the live count and the empty states.
	const matching = $derived(
		index && settings ? shuffleCandidates(index, settings, { list, now: ui.now }) : []
	);
	// Not shown yet, and not the card that's up now.
	const remaining = $derived(
		matching.filter((c) => c.piece.id !== currentId && !shown.includes(c.piece.id)).length
	);

	function next() {
		if (!index || !settings) return;
		const now = Date.now();
		const candidates = shuffleCandidates(index, settings, { shown: new Set(shown), list, now });
		const picked = pickNext(candidates, settings, Math.random, now)?.piece;
		currentId = picked?.id;
		skillAtStart = picked?.skill;
	}

	// Deal the first card once the library is open.
	$effect(() => {
		if (!started && index && settings) {
			started = true;
			untrack(next);
		}
	});

	// With no card up, deal as soon as something unshown matches (after a settings change, say).
	$effect(() => {
		if (started && !currentId && remaining > 0) untrack(next);
	});

	// The piece was deleted or merged away (on another device, say): move on.
	$effect(() => {
		if (currentId && index && (!piece || piece.deletedAt || piece.mergedInto)) untrack(advance);
	});

	function advance() {
		player.close();
		if (currentId) shown = [...shown, currentId];
		next();
	}

	function practiced() {
		const p = piece;
		if (!p) return;
		const skill = p.skill;
		const changed = skill !== skillAtStart && skill !== undefined;
		library.change((d) =>
			logPractice(d, p.id, { via: 'shuffle', ...(changed ? { skillAfter: skill } : {}) })
		);
		ui.now = Date.now();
		advance();
	}

	function restart() {
		player.close();
		shown = [];
		next();
	}

	function setSkill(skill: Skill | null) {
		const id = currentId;
		if (id) library.change((d) => updatePiece(d, id, { skill }));
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
	const key = $derived(piece && index ? index.effectiveKey(piece) : undefined);
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
		<h1>Shuffle</h1>
		<a class="icon-btn close" href={resolve('/(main)')} aria-label="Close shuffle" title="Close"
			>✕</a
		>
	</header>

	{#if library.status === 'error'}
		<div class="empty"><p>Couldn’t open the library: {String(library.error)}</p></div>
	{:else if !index || !settings}
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
					{#if hasKey(piece) && (key || piece.firstNotes)}
						<p class="facts">
							{#if key}<span class="key" data-testid="shuffle-key">{formatKey(key)}</span>{/if}
							{#if piece.firstNotes}<span class="abc" aria-label="First notes"
									>{piece.firstNotes}</span
								>{/if}
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
					<a class="details" href={resolve('/(main)/piece/[id]', { id: piece.id })}>Open details</a>
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
	{:else if matching.length === 0}
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
				{shown.length}
				{shown.length === 1 ? 'piece' : 'pieces'} this round.
			</p>
			<div class="empty-actions">
				<button type="button" onclick={restart}>Restart</button>
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
