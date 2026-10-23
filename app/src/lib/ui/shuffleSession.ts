// Shuffle's order for the session that's up in this tab (PLAN.md §6.5, §14 "Decided for seeded
// Shuffle"). The URL (seed, start time, index) is enough to rebuild an order, but skill and
// favorite edits made during the session would nudge a rebuilt one, so the order as first built
// is also kept here: in memory (so going to a piece's details and back reuses it) and in
// sessionStorage (so a reload does). A new tab, or storage that's unavailable, rebuilds it from
// the URL instead.

import type { PieceId, Skill, Timestamp } from '#lib/domain/types.ts';

export interface ShuffleSnapshot {
	seed: string;
	at: Timestamp;
	/** `shuffleFingerprint` of the settings the order was built with. */
	fingerprint: string;
	ids: PieceId[];
	/** The card that's up, and the piece's own skill when it came up (for `skillAfter`). */
	card?: { id: PieceId; skill?: Skill };
}

const KEY = 'tunejournal.shuffle';
let memory: ShuffleSnapshot | undefined;

function matches(s: ShuffleSnapshot | undefined, seed: string, at: Timestamp, fingerprint: string) {
	return (
		!!s && s.seed === seed && s.at === at && s.fingerprint === fingerprint && Array.isArray(s.ids)
	);
}

/** The saved order for this session and settings, if this tab has one. */
export function loadSnapshot(
	seed: string,
	at: Timestamp,
	fingerprint: string
): ShuffleSnapshot | undefined {
	if (matches(memory, seed, at, fingerprint)) return memory;
	try {
		const raw = sessionStorage.getItem(KEY);
		const stored = raw ? (JSON.parse(raw) as ShuffleSnapshot) : undefined;
		if (matches(stored, seed, at, fingerprint)) return (memory = stored);
	} catch {
		// Private mode or blocked storage: rebuild from the URL.
	}
	return undefined;
}

export function saveSnapshot(snapshot: ShuffleSnapshot) {
	memory = snapshot;
	try {
		sessionStorage.setItem(KEY, JSON.stringify(snapshot));
	} catch {
		// Memory still covers going to details and back.
	}
}
