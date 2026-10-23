import { seedPlayback, type LegacySynthOptions } from './playback.ts';
import type { Library } from './types';

/**
 * 1: the first schema. 2: `settings.playback`, the tag playback profiles (PLAN.md §14 "Tag
 * playback profiles").
 */
export const SCHEMA_VERSION = 2;

export function emptyLibrary(): Library {
	return {
		schemaVersion: SCHEMA_VERSION,
		pieces: {},
		sources: {},
		links: {},
		settings: {
			shuffle: {
				tAge: 0.5,
				tSkill: 1,
				tFav: 2,
				kinds: { session: false, set: false, tune: true, part: false },
				skillMin: 1,
				skillMax: 5
			},
			list: {
				sort: 'title',
				descending: false,
				kinds: { session: false, set: false, tune: true, part: false }
			},
			playback: seedPlayback()
		}
	};
}

/**
 * Upgrades a library in place to SCHEMA_VERSION. Must be idempotent, since concurrent devices
 * may run the same migration. Docs from a newer app version are left untouched.
 *
 * `legacy` is this device's old per-device synth options (the instrument, times through and
 * chords from `localStorage`), used for the seeded playback profiles only when the doc has none
 * yet: once another device has migrated and synced, its profiles win and `legacy` is ignored.
 */
export function migrate(doc: Library, legacy: LegacySynthOptions = {}): void {
	if (doc.schemaVersion >= SCHEMA_VERSION) return;
	if (doc.schemaVersion < 2) {
		doc.settings.playback ??= seedPlayback(legacy);
		doc.schemaVersion = 2;
	}
	doc.schemaVersion = SCHEMA_VERSION;
}
