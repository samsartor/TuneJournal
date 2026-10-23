<!--
	A setting's opening bars as a line of sheet music (the pickers, PLAN.md §6.3), drawn by abcjs
	(loaded on demand) once it scrolls into view. The ABC text shows until then, and if drawing fails.

	While the setting plays (`score` and `time` from the preview), the bars being played are drawn
	over the opening ones, about two at a time (ui/follow.ts), with the note sounding highlighted.
	The opening bars stay underneath, invisible, so the row keeps its height; a window that's
	taller than them is scaled to fit. When it stops, the opening bars show again.
-->
<script lang="ts">
	import type { NoteTimingEvent, TuneObject } from 'abcjs';
	import { abcjsLibrary } from '#lib/audio/synth.ts';
	import { noteAt, windowAbc, windowAt, type ScoreMap, type WindowAbc } from './follow.ts';

	let {
		abc,
		text,
		score,
		time = 0,
		playing = false,
		clock
	}: {
		abc: string;
		text: string;
		/** The tune playing, mapped for following; unset shows the opening bars. */
		score?: ScoreMap;
		/** Where it's playing (tune seconds at 100%), updated a few times a second and on seeks. */
		time?: number;
		playing?: boolean;
		/** The exact time now, read every frame while playing. */
		clock?: () => number;
	} = $props();

	const RENDER = {
		responsive: 'resize',
		paddingtop: 0,
		paddingbottom: 0,
		paddingleft: 0,
		paddingright: 0
	} as const;

	let box = $state<HTMLElement>();
	let host = $state<HTMLElement>();
	let live = $state<HTMLElement>();
	let visible = $state(false);
	let drawn = $state(false);

	$effect(() => {
		const el = box;
		if (!el || visible) return;
		if (typeof IntersectionObserver === 'undefined') {
			visible = true;
			return;
		}
		const observer = new IntersectionObserver((entries) => {
			if (entries.some((e) => e.isIntersecting)) {
				visible = true;
				observer.disconnect();
			}
		});
		observer.observe(el);
		return () => observer.disconnect();
	});

	$effect(() => {
		const el = host;
		const source = abc;
		if (!el || !visible) return;
		let cancelled = false;
		abcjsLibrary()
			.then((abcjs) => {
				if (cancelled) return;
				abcjs.renderAbc(el, source, RENDER);
				drawn = true;
			})
			.catch((e) => console.warn('Couldn’t draw the incipit', e));
		return () => {
			cancelled = true;
		};
	});

	// Following: the time now, from the preview's updates (seeks included) and, while playing,
	// read every frame so the highlight keeps up with the notes.
	let now = $state(0);

	$effect.pre(() => {
		const t = time;
		now = playing && clock ? clock() : t;
	});

	$effect(() => {
		const read = clock;
		if (!score || !playing || !read) return;
		let frame = requestAnimationFrame(function tick() {
			now = read();
			frame = requestAnimationFrame(tick);
		});
		return () => cancelAnimationFrame(frame);
	});

	const windowIndex = $derived(score ? windowAt(score.windows, now) : -1);

	/** The window drawn: its ABC, and its notes' elements by character in that ABC. */
	let shown = $state.raw<{ index: number; slice: WindowAbc; notes: Map<number, Element[]> }>();

	$effect(() => {
		const el = live;
		const map = score;
		const index = windowIndex;
		if (!el || !map || index < 0) {
			shown = undefined;
			return;
		}
		let cancelled = false;
		abcjsLibrary()
			.then((abcjs) => {
				if (cancelled) return;
				const slice = windowAbc(map, map.windows[index].measures);
				const [tune] = abcjs.renderAbc(el, slice.abc, {
					...RENDER,
					add_classes: true
				}) as TuneObject[];
				// The window's own timings, for each note's elements (abcjs' types say void).
				const events = tune
					? ((tune as unknown as { setTiming(): NoteTimingEvent[] }).setTiming() ?? [])
					: [];
				// eslint-disable-next-line svelte/prefer-svelte-reactivity -- built once per window, never changed
				const notes = new Map<number, Element[]>();
				for (const e of events) {
					if (e.type !== 'event' || !e.elements?.length) continue;
					const elements = e.elements.flat() as Element[];
					const chars = e.startCharArray ?? (e.startChar === undefined ? [] : [e.startChar]);
					for (const c of chars) notes.set(c, elements);
				}
				shown = { index, slice, notes };
			})
			.catch((e) => console.warn('Couldn’t draw the bars playing', e));
		return () => {
			cancelled = true;
		};
	});

	let lit: Element[] = [];

	$effect(() => {
		let next: Element[] = [];
		if (score && shown) {
			const i = noteAt(score.notes, now);
			const char = i >= 0 ? shown.slice.charAt(score.notes[i].startChar) : -1;
			next = shown.notes.get(char) ?? [];
		}
		if (next.length === lit.length && next.every((el, i) => el === lit[i])) return;
		for (const el of lit) el.classList.remove('abcjs-current');
		lit = next;
		for (const el of lit) el.classList.add('abcjs-current');
	});

	const following = $derived(drawn && !!score && !!shown);
	const measures = $derived(
		following && shown && score ? score.windows[shown.index].measures.join(',') : undefined
	);
</script>

<span
	class="incipit"
	data-testid="incipit"
	data-drawn={drawn}
	data-following={following}
	data-window={following ? shown?.index : undefined}
	data-measures={measures}
	bind:this={box}
>
	<span
		class="score"
		class:shown={drawn}
		class:hidden={following}
		bind:this={host}
		aria-hidden="true"
	></span>
	{#if score}
		<span class="live" class:shown={following} aria-hidden="true"
			><span bind:this={live}></span></span
		>
	{/if}
	{#if !drawn}<span class="text">{text}</span>{/if}
</span>

<style>
	.incipit {
		position: relative;
		display: block;
		width: 100%;
		max-width: 22rem;
	}

	.score {
		display: block;
	}

	.score.shown,
	.live.shown {
		background: #fff;
		color: #000;
		border-radius: calc(var(--radius) * 0.5);
	}

	.score.hidden {
		visibility: hidden;
	}

	/* The bars playing, over the opening ones, in the same box. */
	.live {
		position: absolute;
		inset: 0;
		overflow: hidden;
		visibility: hidden;
	}

	.live.shown {
		visibility: visible;
	}

	.live > span {
		display: block;
		width: 100%;
		height: 100%;
	}

	/* abcjs sizes its box by the drawing's aspect ratio; here the box is fixed and the drawing fits. */
	.live :global(.abcjs-container) {
		height: 100% !important;
		padding-bottom: 0 !important;
	}

	.live :global(svg) {
		width: 100%;
		height: 100%;
	}

	.live :global(.abcjs-current) {
		fill: var(--color-accent);
		stroke: var(--color-accent);
	}

	.text {
		font-family: var(--font-mono);
		font-size: 0.875rem;
		overflow-wrap: anywhere;
	}
</style>
