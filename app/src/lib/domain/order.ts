// Fractional index keys for ordered things inside maps (clips in a piece, children of a parent).
// Concurrent inserts and reorders then merge without array moves (PLAN.md §5).

import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';

/** Sorts order keys the way fractional-indexing compares them (plain code-unit order). */
export function compareOrder(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

/** The greatest key in `keys`, or null when there are none. */
function last(keys: Iterable<string>): string | null {
	let max: string | null = null;
	for (const key of keys) if (max === null || key > max) max = key;
	return max;
}

/** A key that sorts after every key in `keys`. */
export function orderAfter(keys: Iterable<string>): string {
	return generateKeyBetween(last(keys), null);
}

/** `n` increasing keys that all sort after every key in `keys`. */
export function ordersAfter(keys: Iterable<string>, n: number): string[] {
	return generateNKeysBetween(last(keys), null, n);
}

/**
 * A key between `lower` and `upper` (either may be null for an open end). Concurrent edits can
 * leave two items with the same key, so callers should pass the next key strictly greater than
 * `lower` as `upper`; if they don't, the key just goes after `lower` rather than throwing.
 */
export function orderBetween(lower: string | null, upper: string | null): string {
	if (lower !== null && upper !== null && lower >= upper) upper = null;
	return generateKeyBetween(lower, upper);
}
