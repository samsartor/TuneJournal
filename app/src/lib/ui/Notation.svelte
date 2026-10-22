<!--
	A thesession setting as sheet music, drawn by abcjs (loaded on demand; it's the synthesizer's
	library too). While the same recording plays in the player, the note being played is
	highlighted, from abcjs' own note timings at the tune's 100% tempo (the player reports tune
	time, so this holds at every speed and on every time through).
-->
<script lang="ts">
	import type { NoteTimingEvent, TuneObject } from 'abcjs';
	import { player } from '#lib/audio/player.svelte.ts';
	import { abcjsLibrary } from '#lib/audio/synth.ts';
	import { buildTuneAbc, type SynthTarget } from '#lib/domain/synth.ts';
	import type { ClipId, PieceId } from '#lib/domain/types.ts';
	import { synth } from '#lib/store/synth.svelte.ts';

	let { target, pieceId, clipId }: { target: SynthTarget; pieceId: PieceId; clipId: ClipId } =
		$props();

	let host = $state<HTMLElement>();
	let error = $state('');
	let loading = $state(true);
	let timings = $state.raw<NoteTimingEvent[]>([]);

	$effect(() => {
		const el = host;
		const { tuneId, settingId } = target;
		if (!el) return;
		let cancelled = false;
		loading = true;
		error = '';
		Promise.all([synth.setting({ tuneId, settingId }), abcjsLibrary()])
			.then(([setting, abcjs]) => {
				if (cancelled) return;
				const { abc } = buildTuneAbc(setting, 1);
				const [tune] = abcjs.renderAbc(el, abc, {
					responsive: 'resize',
					add_classes: true,
					paddingleft: 0,
					paddingright: 0
				}) as TuneObject[];
				// setTiming returns the timings, though abcjs' types say void.
				const events = tune
					? (tune as unknown as { setTiming(): NoteTimingEvent[] }).setTiming()
					: [];
				timings = (events ?? []).filter((t) => t.type === 'event' || t.type === 'end');
			})
			.catch((e) => {
				if (!cancelled) error = e instanceof Error ? e.message : String(e);
			})
			.finally(() => {
				if (!cancelled) loading = false;
			});
		return () => {
			cancelled = true;
		};
	});

	/** One time through, in seconds at 100%. */
	const pass = $derived((timings.at(-1)?.milliseconds ?? 0) / 1000);
	const playingHere = $derived(player.isCurrent(pieceId, clipId) && player.kind === 'synth');

	let lit: Element[] = [];

	$effect(() => {
		const ms = playingHere && pass > 0 ? (player.time % pass) * 1000 : -1;
		let next: NoteTimingEvent | undefined;
		if (ms >= 0) {
			for (const t of timings) {
				if (t.milliseconds > ms + 1) break;
				if (t.type === 'event' && t.elements?.length) next = t;
			}
		}
		for (const el of lit) el.classList.remove('abcjs-current');
		lit = (next?.elements ?? []).flat() as Element[];
		for (const el of lit) el.classList.add('abcjs-current');
	});
</script>

<div class="notation" data-testid="notation">
	{#if loading}<p class="muted small">Drawing the notation…</p>{/if}
	{#if error}<p class="error small" role="alert">{error}</p>{/if}
	<div class="score" bind:this={host} aria-label="Sheet music" role="img"></div>
</div>

<style>
	.notation {
		display: grid;
		gap: var(--space-1);
	}

	.score {
		background: #fff;
		color: #000;
		border-radius: calc(var(--radius) * 0.5);
	}

	.score :global(.abcjs-current) {
		fill: var(--color-accent);
		stroke: var(--color-accent);
	}

	p {
		margin: 0;
	}

	.small {
		font-size: 0.875rem;
	}

	.error {
		color: var(--color-danger);
	}
</style>
