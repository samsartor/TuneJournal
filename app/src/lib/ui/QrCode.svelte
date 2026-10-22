<script lang="ts">
	import { encode } from 'uqr';

	let { text, label }: { text: string; label: string } = $props();

	// Always dark on light with a quiet zone: inverted codes don't scan on every phone.
	const qr = $derived(encode(text, { ecc: 'M', border: 3 }));
	const path = $derived.by(() => {
		let d = '';
		qr.data.forEach((row, y) =>
			row.forEach((dark, x) => {
				if (dark) d += `M${x} ${y}h1v1h-1z`;
			})
		);
		return d;
	});
</script>

<svg
	class="qr"
	viewBox="0 0 {qr.size} {qr.size}"
	role="img"
	aria-label={label}
	shape-rendering="crispEdges"
	data-testid="qr-code"
>
	<rect width={qr.size} height={qr.size} fill="#fff" />
	<path d={path} fill="#000" />
</svg>

<style>
	.qr {
		display: block;
		width: 100%;
		max-width: 16rem;
		height: auto;
		border-radius: calc(var(--radius) * 0.75);
		border: 1px solid var(--color-border);
	}
</style>
