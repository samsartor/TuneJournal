// Musical keys are stored normalized as "<tonic> <mode>", e.g. "D major" or "F# dorian" (§5).

export const TONICS = [
	'C',
	'C#',
	'Db',
	'D',
	'Eb',
	'E',
	'F',
	'F#',
	'Gb',
	'G',
	'Ab',
	'A',
	'Bb',
	'B'
] as const;

export const MODES = ['major', 'minor', 'dorian', 'mixolydian', 'lydian', 'phrygian', 'locrian'];

/** Every accepted mode word and the mode it normalizes to. Any 3+ letter prefix matches. */
const MODE_WORDS: [string, string][] = [
	['major', 'major'],
	['ionian', 'major'],
	['minor', 'minor'],
	['aeolian', 'minor'],
	['dorian', 'dorian'],
	['mixolydian', 'mixolydian'],
	['lydian', 'lydian'],
	['phrygian', 'phrygian'],
	['locrian', 'locrian']
];

export interface ParsedKey {
	tonic: string;
	mode: string;
}

/** Parses "D", "Dmaj", "Em", "A dorian", "f# Mix", "B♭ major" and similar. */
export function parseKey(input: string): ParsedKey | undefined {
	const m = /^([A-Ga-g])\s*([#b♯♭]?)\s*([A-Za-z]*)$/.exec(input.trim());
	if (!m) return undefined;
	const tonic = m[1].toUpperCase() + m[2].replace('♯', '#').replace('♭', 'b');
	const word = m[3].toLowerCase();
	let mode: string | undefined;
	if (word === '') mode = 'major';
	else if (word === 'm') mode = 'minor';
	else if (word.length >= 3) mode = MODE_WORDS.find(([w]) => w.startsWith(word))?.[1];
	return mode ? { tonic, mode } : undefined;
}

/**
 * The stored form of a user-entered key: normalized when it parses, otherwise the trimmed free
 * text. Empty input gives undefined.
 */
export function normalizeKey(input: string): string | undefined {
	const text = input.trim().replace(/\s+/g, ' ');
	if (!text) return undefined;
	const parsed = parseKey(text);
	return parsed ? `${parsed.tonic} ${parsed.mode}` : text;
}

/** Short display form: "D major" → "D maj", "A dorian" → "A dor". Free text is shown as is. */
export function formatKey(key: string): string {
	const parsed = parseKey(key);
	return parsed ? `${parsed.tonic} ${parsed.mode.slice(0, 3)}` : key;
}
