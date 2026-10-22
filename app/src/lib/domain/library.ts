import type { Library } from './types';

export const SCHEMA_VERSION = 1;

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
			}
		}
	};
}

/**
 * Upgrades a library in place to SCHEMA_VERSION. Must be idempotent, since concurrent devices
 * may run the same migration. Docs from a newer app version are left untouched.
 */
export function migrate(doc: Library): void {
	if (doc.schemaVersion >= SCHEMA_VERSION) return;
	// Future steps go here: if (doc.schemaVersion < 2) { ...; doc.schemaVersion = 2; }
	doc.schemaVersion = SCHEMA_VERSION;
}
