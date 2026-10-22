import type { Library } from './types.ts';

export interface CopyResult {
	pieces: number;
	sources: number;
	links: number;
}

/**
 * Copies pieces, sources and links that `target` lacks from a plain-JSON `incoming` library. Used
 * to import a backup of an unrelated library, where a CRDT merge would make the two root maps
 * conflict instead of combining. Existing ids and settings are left alone.
 */
export function copyMissing(target: Library, incoming: Library): CopyResult {
	const result: CopyResult = { pieces: 0, sources: 0, links: 0 };
	for (const field of ['pieces', 'sources', 'links'] as const) {
		const into = target[field] as Record<string, unknown>;
		for (const [id, value] of Object.entries(incoming[field] ?? {})) {
			if (id in into) continue;
			into[id] = structuredClone(value);
			result[field]++;
		}
	}
	return result;
}
