<script lang="ts">
	import type { PieceId } from '#lib/domain/types.ts';
	import PieceDetail from '#lib/ui/PieceDetail.svelte';
	import type { PageProps } from './$types';

	let { params }: PageProps = $props();
</script>

{#key params.id}
	<PieceDetail id={params.id as PieceId} />
{/key}
