<script lang="ts">
	import { SKILL_LABEL } from '#lib/domain/format.ts';
	import type { Skill } from '#lib/domain/types.ts';

	let { skill }: { skill?: Skill } = $props();
</script>

{#if skill}
	<span class="dots" role="img" aria-label="Skill {skill} of 5: {SKILL_LABEL[skill]}">
		{#each [1, 2, 3, 4, 5] as n (n)}
			<span class="dot" class:on={n <= skill}></span>
		{/each}
	</span>
{:else}
	<span class="unrated">unrated</span>
{/if}

<style>
	.dots {
		display: inline-flex;
		gap: 3px;
		vertical-align: middle;
	}

	.dot {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		border: 1px solid var(--color-accent);
	}

	.dot.on {
		background: var(--color-accent);
	}

	.unrated {
		color: var(--color-muted);
		font-style: italic;
	}
</style>
