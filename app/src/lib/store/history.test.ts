import { describe, expect, it } from 'vitest';
import * as Automerge from '@automerge/automerge';
import { emptyLibrary } from '#lib/domain/library.ts';
import { createPiece } from '#lib/domain/ops.ts';
import type { Library } from '#lib/domain/types.ts';
import { sharesHistory } from './history';

const create = () =>
	Automerge.from(
		emptyLibrary() as unknown as Record<string, unknown>
	) as unknown as Automerge.Doc<Library>;

describe('sharesHistory', () => {
	it('recognises a backup of the same library, even after both sides changed', () => {
		const base = create();
		const backup = Automerge.load<Library>(Automerge.save(base));
		const a = Automerge.change(Automerge.clone(base), (d) => void createPiece(d, { title: 'A' }));
		const b = Automerge.change(backup, (d) => void createPiece(d, { title: 'B' }));
		expect(sharesHistory(a, b)).toBe(true);
		const merged = Automerge.loadIncremental(a, Automerge.save(b));
		expect(
			Object.values(merged.pieces)
				.map((p) => p.title)
				.sort()
		).toEqual(['A', 'B']);
	});

	it('tells unrelated libraries apart', () => {
		expect(sharesHistory(create(), create())).toBe(false);
	});
});
