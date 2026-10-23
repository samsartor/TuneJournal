<!--
	A setting's opening bars as a line of sheet music (the pickers, PLAN.md §6.3), drawn by abcjs
	(loaded on demand) once it scrolls into view. The ABC text shows until then, and if drawing fails.
-->
<script lang="ts">
	import { abcjsLibrary } from '#lib/audio/synth.ts';

	let { abc, text }: { abc: string; text: string } = $props();

	let box = $state<HTMLElement>();
	let host = $state<HTMLElement>();
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
				abcjs.renderAbc(el, source, {
					responsive: 'resize',
					paddingtop: 0,
					paddingbottom: 0,
					paddingleft: 0,
					paddingright: 0
				});
				drawn = true;
			})
			.catch((e) => console.warn('Couldn’t draw the incipit', e));
		return () => {
			cancelled = true;
		};
	});
</script>

<span class="incipit" data-testid="incipit" data-drawn={drawn} bind:this={box}>
	<span class="score" class:shown={drawn} bind:this={host} aria-hidden="true"></span>
	{#if !drawn}<span class="text">{text}</span>{/if}
</span>

<style>
	.incipit {
		display: block;
		width: 100%;
		max-width: 22rem;
	}

	.score {
		display: block;
	}

	.score.shown {
		background: #fff;
		color: #000;
		border-radius: calc(var(--radius) * 0.5);
	}

	.text {
		font-family: var(--font-mono);
		font-size: 0.875rem;
		overflow-wrap: anywhere;
	}
</style>
