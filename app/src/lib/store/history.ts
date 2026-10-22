import * as Automerge from '@automerge/automerge';

function roots(doc: Automerge.Doc<unknown>): Set<string> {
	const hashes = new Set<string>();
	for (const change of Automerge.getAllChanges(doc)) {
		const decoded = Automerge.decodeChange(change);
		if (decoded.deps.length === 0 && decoded.hash) hashes.add(decoded.hash);
	}
	return hashes;
}

/** Whether two docs grew from a common root change, i.e. are copies of the same library. */
export function sharesHistory(a: Automerge.Doc<unknown>, b: Automerge.Doc<unknown>): boolean {
	const ours = roots(a);
	for (const hash of roots(b)) if (ours.has(hash)) return true;
	return false;
}
