// What each recording provider is and how it plays (PLAN.md §6.6, §6.7). Pure data, shared by the
// list cards, the recordings section and the player.

import type { Provider, Source } from './types.ts';

/**
 * How a source plays: `file` through <audio> (a cached blob, or a direct audio URL), `youtube`
 * through the IFrame player, `synth` as audio synthesized from a thesession.org setting's ABC
 * (`clipPlayback`), and `link` by opening the URL in a new tab.
 */
export type Playback = 'file' | 'youtube' | 'synth' | 'link';

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

/** What's known about synthesizing a thesession link (see domain/synth.ts `synthTarget`). */
export interface SynthAvailability {
	/** The piece's chosen setting of the linked tune, if it has one. */
	settingId?: number;
	/** Its ABC is on this device (integration cache) or can be fetched (online). */
	available: boolean;
}

/**
 * How a clip plays, all things considered: like its source, except that a thesession tune link
 * with a chosen setting whose ABC is at hand plays a synthesized rendering of that setting in the
 * app. With no setting, or offline before the tune was ever loaded, it opens thesession.org.
 */
export function clipPlayback(
	source: Pick<Source, 'provider' | 'url' | 'mime'>,
	synth?: SynthAvailability
): Playback {
	const kind = playbackOf(source);
	if (
		kind === 'link' &&
		source.provider === 'thesession' &&
		synth?.settingId !== undefined &&
		synth.available
	) {
		return 'synth';
	}
	return kind;
}

/** Plays inside the app (rather than only opening elsewhere). A real recording, not a synth. */
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

/** The Drive file's own page (Drive's web view). */
export function driveFileUrl(fileId: string): string {
	return `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`;
}

/**
 * Where "Open link ↗" goes for a recording: the Drive file's page for anything kept in Drive (a
 * picked Drive file, or a backed-up upload), else its own web link (YouTube, Spotify,
 * thesession.org, any other URL). Undefined for an upload that exists only on one device.
 */
export function openLinkOf(
	source: Pick<Source, 'provider' | 'url' | 'externalId' | 'assetKey'>
): string | undefined {
	const drive = driveFileId(source);
	if (drive) return driveFileUrl(drive);
	return /^https?:\/\//i.test(source.url) ? source.url : undefined;
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
