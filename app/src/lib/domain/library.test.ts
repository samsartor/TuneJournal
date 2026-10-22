import { describe, expect, it } from 'vitest';
import * as Automerge from '@automerge/automerge';
import { SCHEMA_VERSION, emptyLibrary, migrate } from './library';

function hasUndefined(value: unknown): boolean {
	if (value === undefined) return true;
	if (value === null || typeof value !== 'object') return false;
	return Object.values(value).some(hasUndefined);
}

describe('emptyLibrary', () => {
	it('is at the current schema version and empty', () => {
		const lib = emptyLibrary();
		expect(lib.schemaVersion).toBe(SCHEMA_VERSION);
		expect(lib.pieces).toEqual({});
		expect(lib.sources).toEqual({});
		expect(lib.links).toEqual({});
	});

	it('contains no undefined values', () => {
		expect(hasUndefined(emptyLibrary())).toBe(false);
	});

	it('round-trips through Automerge', () => {
		const doc = Automerge.from(emptyLibrary() as unknown as Record<string, unknown>);
		expect(Automerge.toJS(doc)).toEqual(emptyLibrary());
	});
});

describe('migrate', () => {
	it('is a no-op at the current version', () => {
		const lib = emptyLibrary();
		migrate(lib);
		expect(lib).toEqual(emptyLibrary());
	});

	it('upgrades older docs and is idempotent', () => {
		const lib = { ...emptyLibrary(), schemaVersion: 0 };
		migrate(lib);
		migrate(lib);
		expect(lib.schemaVersion).toBe(SCHEMA_VERSION);
	});

	it('leaves docs from newer versions alone', () => {
		const lib = { ...emptyLibrary(), schemaVersion: SCHEMA_VERSION + 1 };
		migrate(lib);
		expect(lib.schemaVersion).toBe(SCHEMA_VERSION + 1);
	});
});
