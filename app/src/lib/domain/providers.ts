// What each recording provider is and how it plays (PLAN.md §6.6, §6.7). Pure data, shared by the
// list cards, the recordings section and the player.

import type { Provider, Source } from './types.ts';

/**
 * How a source plays: `file` through <audio> (a cached blob, or a direct audio URL), `youtube`
 * through the IFrame player, and `link` by opening the URL in a new tab.
 */
export type Playback = 'file' | 'youtube' | 'link';

export interface ProviderInfo {
	label: string;
	/** A short glyph for cards and clip rows. Decorative: always paired with a label. */
	icon: string;
	/** A recording (something to listen to), rather than a reference link like thesession. */
	recording: boolean;
}

export const PROVIDERS: Record<Provider, ProviderInfo> = {
	upload: { label: 'Upload', icon: '♪', recording: true },
	gdrive: { label: 'Google Drive', icon: '▲', recording: true },
	grecorder: { label: 'Recorder', icon: '●', recording: true },
	youtube: { label: 'YouTube', icon: '▶', recording: true },
	spotify: { label: 'Spotify', icon: '♫', recording: true },
	thesession: { label: 'thesession.org', icon: '§', recording: false },
	folkfriend: { label: 'FolkFriend', icon: '♣', recording: false },
	url: { label: 'Link', icon: '🔗', recording: true }
};

const AUDIO_EXTENSION = /\.(mp3|m4a|mp4|aac|wav|ogg|oga|opus|flac|webm|weba)$/i;

/** Whether a URL points straight at an audio file that <audio> can play. */
export function isAudioUrl(url: string): boolean {
	try {
		return AUDIO_EXTENSION.test(new URL(url).pathname);
	} catch {
		return false;
	}
}

export function playbackOf(source: Pick<Source, 'provider' | 'url' | 'mime'>): Playback {
	switch (source.provider) {
		case 'upload':
		case 'gdrive':
		case 'grecorder':
			return 'file';
		case 'youtube':
			return 'youtube';
		case 'url':
			return source.mime?.startsWith('audio/') || isAudioUrl(source.url) ? 'file' : 'link';
		default:
			return 'link';
	}
}

/** Plays inside the app (rather than only opening elsewhere). */
export function isPlayable(source: Pick<Source, 'provider' | 'url' | 'mime'>): boolean {
	return playbackOf(source) !== 'link';
}

/** The audio bytes are ours to cache (file sources other than a remote URL we merely link to). */
export function isCacheable(source: Pick<Source, 'provider' | 'url' | 'mime'>): boolean {
	return playbackOf(source) === 'file';
}

/** `assetKey` prefix for a copy of the bytes kept in the user's Google Drive. */
export const DRIVE_ASSET = 'gdrive:';

/** The Drive file holding this source's audio, if there is one. */
export function driveFileId(source: Pick<Source, 'provider' | 'externalId' | 'assetKey'>) {
	if (source.provider === 'gdrive' && source.externalId) return source.externalId;
	if (source.assetKey?.startsWith(DRIVE_ASSET)) return source.assetKey.slice(DRIVE_ASSET.length);
	return undefined;
}

/**
 * Uploaded audio that exists only on the device it was added from: nothing to fetch it from
 * elsewhere until it's backed up.
 */
export function isLocalOnly(source: Pick<Source, 'provider' | 'externalId' | 'assetKey'>) {
	return (source.provider === 'upload' || source.provider === 'grecorder') && !driveFileId(source);
}

/**
 * What to call a recording: the clip's own title, the source's (a file name), a title looked up
 * elsewhere (oEmbed, from the integration cache), or the provider's name.
 */
export function recordingTitle(
	clip: { title?: string },
	source: Pick<Source, 'provider' | 'title'>,
	lookedUp?: string
): string {
	const info = PROVIDERS[source.provider];
	return (
		clip.title ??
		source.title ??
		lookedUp ??
		(info.recording ? `${info.label} recording` : info.label)
	);
}
