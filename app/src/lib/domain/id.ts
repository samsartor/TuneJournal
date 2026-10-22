const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** A random 16-character id (~95 bits), URL-safe. */
export function newId(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(16));
	let id = '';
	// 62 doesn't divide 256, so the bias is tiny (≤ 4/256 per char); fine for ids.
	for (const b of bytes) id += ALPHABET[b % ALPHABET.length];
	return id;
}
