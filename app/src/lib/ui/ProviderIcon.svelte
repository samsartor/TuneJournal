<script lang="ts">
	import { PROVIDERS } from '#lib/domain/providers.ts';
	import type { Provider } from '#lib/domain/types.ts';

	let { provider, label = true }: { provider: Provider; label?: boolean } = $props();

	const info = $derived(PROVIDERS[provider]);
</script>

<span
	class="provider"
	style:--accent="var(--provider-{provider})"
	title={info.label}
	role={label ? 'img' : undefined}
	aria-label={label ? info.label : undefined}
	aria-hidden={label ? undefined : 'true'}>{info.icon}</span
>

<style>
	.provider {
		display: inline-grid;
		place-items: center;
		width: 1.5rem;
		height: 1.5rem;
		flex: none;
		border-radius: 0.4rem;
		background: color-mix(in srgb, var(--accent) 16%, transparent);
		color: var(--accent);
		font-size: 0.8125rem;
		line-height: 1;
	}
</style>
