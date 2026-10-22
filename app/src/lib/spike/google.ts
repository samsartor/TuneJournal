// Spike-only: Google Identity Services + Picker + Drive REST, loaded from Google's CDN at runtime.
// Only the bits of the (untyped) globals we touch are declared here.

export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

interface TokenResponse {
	access_token?: string;
	expires_in?: number;
	error?: string;
	error_description?: string;
}

interface TokenClient {
	requestAccessToken(overrides?: { prompt?: string }): void;
}

export interface PickedDoc {
	id: string;
	name: string;
	mimeType: string;
	sizeBytes?: number;
}

interface PickerResult {
	action: string;
	docs?: PickedDoc[];
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type GoogleGlobal = any;
type GapiGlobal = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

declare global {
	interface Window {
		google?: GoogleGlobal;
		gapi?: GapiGlobal;
	}
}

const loaded = new Map<string, Promise<void>>();

function loadScript(src: string): Promise<void> {
	let p = loaded.get(src);
	if (!p) {
		p = new Promise((resolve, reject) => {
			const s = document.createElement('script');
			s.src = src;
			s.async = true;
			s.onload = () => resolve();
			s.onerror = () => reject(new Error(`Failed to load ${src}`));
			document.head.append(s);
		});
		loaded.set(src, p);
	}
	return p;
}

export async function loadGoogle(): Promise<void> {
	await Promise.all([
		loadScript('https://accounts.google.com/gsi/client'),
		loadScript('https://apis.google.com/js/api.js')
	]);
	await new Promise<void>((resolve, reject) =>
		window.gapi.load('picker', { callback: resolve, onerror: reject })
	);
}

/** Pops the GIS consent/account chooser and resolves with a short-lived (1h) access token. */
export function requestToken(
	clientId: string,
	prompt = ''
): Promise<{ token: string; expiresAt: number }> {
	return new Promise((resolve, reject) => {
		const client: TokenClient = window.google.accounts.oauth2.initTokenClient({
			client_id: clientId,
			scope: DRIVE_FILE_SCOPE,
			callback: (r: TokenResponse) => {
				if (r.error || !r.access_token) reject(new Error(r.error_description ?? r.error));
				else resolve({ token: r.access_token, expiresAt: Date.now() + (r.expires_in ?? 0) * 1000 });
			},
			error_callback: (e: { type: string; message?: string }) =>
				reject(new Error(e.message ?? e.type))
		});
		client.requestAccessToken({ prompt });
	});
}

export function pickAudio(opts: {
	token: string;
	apiKey: string;
	appId: string;
}): Promise<PickedDoc | undefined> {
	const picker = window.google.picker;
	return new Promise((resolve) => {
		const view = new picker.DocsView(picker.ViewId.DOCS)
			.setMimeTypes(
				'audio/mp4,audio/x-m4a,audio/mpeg,audio/ogg,audio/wav,audio/webm,audio/aac,audio/flac,video/mp4'
			)
			.setIncludeFolders(true);
		new picker.PickerBuilder()
			.addView(view)
			.setOAuthToken(opts.token)
			.setDeveloperKey(opts.apiKey)
			// Picking a file grants drive.file access to it, scoped to this Cloud project.
			.setAppId(opts.appId)
			.setCallback((r: PickerResult) => {
				if (r.action === picker.Action.PICKED) resolve(r.docs?.[0]);
				else if (r.action === picker.Action.CANCEL) resolve(undefined);
			})
			.build()
			.setVisible(true);
	});
}

async function drive(token: string, url: string, init: RequestInit = {}) {
	const res = await fetch(url, {
		...init,
		headers: { ...init.headers, Authorization: `Bearer ${token}` }
	});
	if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
	return res;
}

export async function download(token: string, fileId: string): Promise<Blob> {
	return (await drive(token, `${DRIVE}/files/${encodeURIComponent(fileId)}?alt=media`)).blob();
}

/** Finds or creates the app folder. drive.file only sees folders this app created. */
export async function ensureFolder(token: string, name = 'TuneJournal'): Promise<string> {
	const q = `name = '${name}' and mimeType = '${FOLDER_MIME}' and trashed = false`;
	const list = await (
		await drive(token, `${DRIVE}/files?q=${encodeURIComponent(q)}&fields=files(id,name)`)
	).json();
	if (list.files?.[0]) return list.files[0].id;
	const created = await (
		await drive(token, `${DRIVE}/files?fields=id`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name, mimeType: FOLDER_MIME })
		})
	).json();
	return created.id;
}

export async function upload(
	token: string,
	folderId: string,
	file: Blob,
	name: string
): Promise<{ id: string; name: string; webViewLink: string }> {
	const body = new FormData();
	body.append(
		'metadata',
		new Blob([JSON.stringify({ name, parents: [folderId] })], { type: 'application/json' })
	);
	body.append('file', file);
	const res = await drive(
		token,
		`${UPLOAD}/files?uploadType=multipart&fields=id,name,webViewLink`,
		{ method: 'POST', body }
	);
	return res.json();
}
