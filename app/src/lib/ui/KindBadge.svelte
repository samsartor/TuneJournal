<script lang="ts">
	import { KIND_LABEL } from '#lib/domain/format.ts';
	import type { PieceKind } from '#lib/domain/types.ts';

	let { kind }: { kind: PieceKind } = $props();
</script>

<span class="badge {kind}">{KIND_LABEL[kind]}</span>

<style>
	.badge {
		flex: none;
		padding: 0.05rem 0.45rem;
		border-radius: 0.375rem;
		border: 1px solid currentColor;
		color: var(--color-accent);
		font-size: 0.6875rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.set {
		color: #8a5a9e;
	}

	.part {
		color: #9a6a1f;
	}

	.session {
		color: #2f5f8f;
	}

	@media (prefers-color-scheme: dark) {
		.set {
			color: #c49ad6;
		}

		.part {
			color: #e0b062;
		}

		.session {
			color: #8bb6e3;
		}
	}
</style>
