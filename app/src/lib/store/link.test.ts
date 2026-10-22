import { generateAutomergeUrl } from '@automerge/automerge-repo/slim';
import { describe, expect, it } from 'vitest';
import { libraryDeepLink, parseLibraryLink } from './link.ts';

const url = generateAutomergeUrl();
const PREFIX_LENGTH = 'automerge:'.length;

describe('parseLibraryLink', () => {
	it('accepts a bare automerge URL, ignoring surrounding whitespace', () => {
		expect(parseLibraryLink(url)).toBe(url);
		expect(parseLibraryLink(`  ${url}\n`)).toBe(url);
	});

	it('accepts a deep link, with or without an encoded hash', () => {
		expect(parseLibraryLink(`https://tunes.example/link-device#${url}`)).toBe(url);
		expect(parseLibraryLink(`https://tunes.example/app/link-device?x=1#${url}`)).toBe(url);
		expect(parseLibraryLink(`https://tunes.example/link-device#${encodeURIComponent(url)}`)).toBe(
			url
		);
	});

	it('drops heads pinned in the URL', () => {
		expect(parseLibraryLink(`${url}#2Zw8bPzA|3d8zjSdy`)).toBe(url);
	});

	it('rejects anything else', () => {
		for (const bad of [
			undefined,
			null,
			'',
			'   ',
			'automerge:',
			'automerge:not-a-document-id',
			url.slice(PREFIX_LENGTH),
			`https://tunes.example/link-device#${url.slice(0, -3)}`,
			'https://tunes.example/link-device',
			'https://tunes.example/link-device#%E0%A4%A'
		]) {
			expect(parseLibraryLink(bad), String(bad)).toBeUndefined();
		}
	});
});

describe('libraryDeepLink', () => {
	it('puts the library URL in the hash of the link-device page', () => {
		const link = libraryDeepLink('https://tunes.example/link-device', url);
		expect(link).toBe(`https://tunes.example/link-device#${url}`);
		expect(parseLibraryLink(link)).toBe(url);
	});

	it('replaces any query or hash the page URL had', () => {
		const link = libraryDeepLink('https://tunes.example/link-device?from=settings#old', url);
		expect(link).toBe(`https://tunes.example/link-device#${url}`);
	});
});
