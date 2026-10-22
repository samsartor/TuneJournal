import { describe, expect, it } from 'vitest';
import { detectLink, findUrl, parseTimestamp } from './links';

describe('detectLink', () => {
	it.each([
		['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ', undefined],
		['https://youtu.be/dQw4w9WgXcQ?t=42', 'dQw4w9WgXcQ', 42],
		['https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=1m5s', 'dQw4w9WgXcQ', 65],
		['https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=x', 'dQw4w9WgXcQ', undefined],
		['https://www.youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ', undefined],
		['https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=10', 'dQw4w9WgXcQ', 10],
		['  https://youtube.com/live/dQw4w9WgXcQ  ', 'dQw4w9WgXcQ', undefined]
	])('YouTube %s', (input, id, start) => {
		const link = detectLink(input);
		expect(link).toMatchObject({
			provider: 'youtube',
			externalId: id,
			url: `https://www.youtube.com/watch?v=${id}`
		});
		expect(link?.start).toBe(start);
	});

	it('treats a YouTube page without a video as a plain link', () => {
		expect(detectLink('https://www.youtube.com/@someone')?.provider).toBe('url');
	});

	it('Spotify links and URIs', () => {
		const expected = {
			provider: 'spotify',
			url: 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC',
			externalId: 'track:4uLU6hMCjMI75M1A2tKUQC'
		};
		expect(detectLink('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=abc')).toEqual(
			expected
		);
		expect(detectLink('https://open.spotify.com/intl-de/track/4uLU6hMCjMI75M1A2tKUQC')).toEqual(
			expected
		);
		expect(detectLink('spotify:track:4uLU6hMCjMI75M1A2tKUQC')).toEqual(expected);
		expect(detectLink('https://open.spotify.com/album/1A2B')?.externalId).toBe('album:1A2B');
	});

	it('Drive, thesession, folkfriend', () => {
		expect(detectLink('https://drive.google.com/file/d/1AbC-d_E/view?usp=sharing')).toEqual({
			provider: 'gdrive',
			url: 'https://drive.google.com/file/d/1AbC-d_E/view',
			externalId: '1AbC-d_E'
		});
		expect(detectLink('https://drive.google.com/open?id=XYZ')?.externalId).toBe('XYZ');
		expect(detectLink('https://thesession.org/tunes/1#setting1')).toEqual({
			provider: 'thesession',
			url: 'https://thesession.org/tunes/1',
			externalId: '1'
		});
		expect(detectLink('https://folkfriend.app/tune?x=1')?.provider).toBe('folkfriend');
	});

	it('anything else is a generic link without its hash', () => {
		expect(detectLink('https://example.com/a/tune.mp3#t=3')).toEqual({
			provider: 'url',
			url: 'https://example.com/a/tune.mp3',
			externalId: 'https://example.com/a/tune.mp3'
		});
	});

	it('rejects non-links', () => {
		expect(detectLink('hello')).toBeUndefined();
		expect(detectLink('')).toBeUndefined();
		expect(detectLink('javascript:alert(1)')).toBeUndefined();
		expect(detectLink('ftp://example.com/x')).toBeUndefined();
	});
});

describe('helpers', () => {
	it('parseTimestamp', () => {
		expect(parseTimestamp('90')).toBe(90);
		expect(parseTimestamp('90s')).toBe(90);
		expect(parseTimestamp('1h2m3s')).toBe(3723);
		expect(parseTimestamp('2m')).toBe(120);
		expect(parseTimestamp('x')).toBeUndefined();
		expect(parseTimestamp('')).toBeUndefined();
		expect(parseTimestamp(null)).toBeUndefined();
	});

	it('findUrl', () => {
		expect(findUrl('Listen: https://youtu.be/dQw4w9WgXcQ.')).toBe('https://youtu.be/dQw4w9WgXcQ');
		expect(findUrl('(see https://e.com/x)')).toBe('https://e.com/x');
		expect(findUrl('no link here')).toBeUndefined();
	});
});
