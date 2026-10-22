<script lang="ts">
	import { resolve } from '$app/paths';
</script>

<main>
	<a class="back" href={resolve('/(main)')}>← All pieces</a>
	<div class="body">
		<p class="icon" aria-hidden="true">⤮</p>
		<h1>Shuffle</h1>
		<p class="muted">Flashcard practice with tunable randomness is coming soon.</p>
	</div>
</main>

<style>
	main {
		display: grid;
		grid-template-rows: auto 1fr;
		min-height: 100dvh;
		padding: var(--space-3);
	}

	.back {
		display: inline-flex;
		align-items: center;
		min-height: var(--touch);
		text-decoration: none;
		font-weight: 600;
	}

	.body {
		display: grid;
		place-content: center;
		text-align: center;
	}

	.icon {
		margin: 0;
		font-size: 3rem;
		color: var(--color-accent);
	}

	h1 {
		margin: 0;
	}
</style>
