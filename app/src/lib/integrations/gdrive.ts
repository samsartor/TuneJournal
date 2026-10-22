// Google Drive (PLAN.md §7): GIS token client + Picker + Drive REST, all from the browser with the
// non-sensitive `drive.file` scope, so the app sees only files the user picks or the app creates.
// Configured in Settings → Google Drive (saved on the device only), falling back to
// PUBLIC_GOOGLE_{CLIENT_ID,API_KEY,APP_ID} from the build; with any of them missing, the UI hides
// Drive. Google's scripts load on first use only.
//
// The request builders and DriveClient are pure apart from `fetch` and a token source, so they're
// unit-tested with a mocked fetch. GisTokenSource and the Picker need a real browser and Google
// account, and are pending a manual test (spikes/README.md §1).

export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const DRIVE_API = 'https://www.googleapis.com/drive/v3';
export const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
export const FOLDER_MIME = 'application/vnd.google-apps.folder';
export const APP_FOLDER = 'TuneJournal';

export const AUDIO_MIME_TYPES = [
	'audio/mp4',
	'audio/x-m4a',
	'audio/m4a',
	'audio/mpeg',
	'audio/ogg',
	'audio/opus',
	'audio/wav',
	'audio/x-wav',
	'audio/webm',
	'audio/aac',
	'audio/flac',
	'video/mp4'
];

export interface GoogleConfig {
	clientId: string;
	apiKey: string;
	appId: string;
}

export function isConfigured(config: Partial<GoogleConfig>): config is GoogleConfig {
	return !!(config.clientId && config.apiKey && config.appId);
}

export const CONFIG_FIELDS = ['clientId', 'apiKey', 'appId'] as const;

/** Device-local Drive settings (localStorage). Never synced: each device and origin has its own. */
export const DEVICE_CONFIG_KEY = 'tunejournal.gdrive.config';

/** Trimmed, without blanks. */
export function cleanConfig(config: unknown): Partial<GoogleConfig> {
	const raw = (config && typeof config === 'object' ? config : {}) as Record<string, unknown>;
	const clean: Partial<GoogleConfig> = {};
	for (const field of CONFIG_FIELDS) {
		const value = typeof raw[field] === 'string' ? raw[field].trim() : '';
		if (value) clean[field] = value;
	}
	return clean;
}

/** The settings saved on this device. */
export function readDeviceConfig(storage = globalThis.localStorage): Partial<GoogleConfig> {
	try {
		return cleanConfig(JSON.parse(storage?.getItem(DEVICE_CONFIG_KEY) ?? '{}'));
	} catch {
		return {};
	}
}

/** Saves (or, when everything is blank, forgets) this device's settings; returns what's saved. */
export function writeDeviceConfig(
	config: Partial<GoogleConfig>,
	storage = globalThis.localStorage
): Partial<GoogleConfig> {
	const clean = cleanConfig(config);
	try {
		if (Object.keys(clean).length > 0) storage?.setItem(DEVICE_CONFIG_KEY, JSON.stringify(clean));
		else storage?.removeItem(DEVICE_CONFIG_KEY);
	} catch {
		throw new Error('This browser won’t let TuneJournal save settings.');
	}
	return clean;
}

/** Device values win field by field; the build's values fill the rest. */
export function mergeConfig(
	device: Partial<GoogleConfig>,
	build: Partial<GoogleConfig>
): Partial<GoogleConfig> {
	const merged: Partial<GoogleConfig> = {};
	for (const field of CONFIG_FIELDS) {
		const value = device[field]?.trim() || build[field]?.trim();
		if (value) merged[field] = value;
	}
	return merged;
}

/** Likely typos, as warnings: Google's own errors for these are cryptic. */
export function configProblems(config: Partial<GoogleConfig>): string[] {
	const problems: string[] = [];
	if (config.clientId && !/\.apps\.googleusercontent\.com$/.test(config.clientId)) {
		problems.push('The client ID usually ends in “.apps.googleusercontent.com”.');
	}
	if (config.appId && !/^\d+$/.test(config.appId)) {
		problems.push('The app ID is the project number: digits only.');
	}
	if (config.apiKey && /\s/.test(config.apiKey)) {
		problems.push('The API key has spaces in it.');
	}
	return problems;
}

/** The link stored on a Drive Source: opens the file in Drive. */
export { driveFileUrl } from '#lib/domain/providers.ts';

// Request builders

export interface DriveRequest {
	url: string;
	init: RequestInit;
}

export function downloadRequest(fileId: string): DriveRequest {
	return { url: `${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`, init: {} };
}

/** Drive query strings quote with single quotes and escape `\` and `'`. */
export function quoteQuery(value: string): string {
	return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

export function findFolderRequest(name = APP_FOLDER): DriveRequest {
	const q = `name = ${quoteQuery(name)} and mimeType = '${FOLDER_MIME}' and trashed = false`;
	return {
		url: `${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent('files(id,name)')}&spaces=drive`,
		init: {}
	};
}

export function createFolderRequest(name = APP_FOLDER): DriveRequest {
	return {
		url: `${DRIVE_API}/files?fields=id`,
		init: {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name, mimeType: FOLDER_MIME })
		}
	};
}

/** A multipart upload: JSON metadata, then the bytes. */
export function uploadRequest(folderId: string, file: Blob, name: string): DriveRequest {
	const body = new FormData();
	const metadata: Record<string, unknown> = { name, parents: [folderId] };
	if (file.type) metadata.mimeType = file.type;
	body.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
	body.append('file', file);
	return {
		url: `${DRIVE_UPLOAD}/files?uploadType=multipart&fields=${encodeURIComponent('id,name,mimeType,webViewLink')}`,
		init: { method: 'POST', body }
	};
}

// Client

export class DriveError extends Error {
	constructor(
		readonly status: number,
		message: string
	) {
		super(message);
		this.name = 'DriveError';
	}
}

export interface TokenSource {
	/**
	 * A valid access token. `renew` asks for a new one even if a cached token hasn't expired,
	 * e.g. after Drive answered 401. May open Google's popup.
	 */
	token(options?: { renew?: boolean }): Promise<string>;
}

export interface UploadedFile {
	id: string;
	name: string;
	mimeType?: string;
	webViewLink?: string;
}

export class DriveClient {
	#folder?: Promise<string>;

	constructor(
		private readonly tokens: TokenSource,
		private readonly fetcher: typeof fetch = (...args) => fetch(...args)
	) {}

	/** Sends a request with the bearer token; on 401 gets a fresh token and tries once more. */
	async send({ url, init }: DriveRequest): Promise<Response> {
		let renew = false;
		for (;;) {
			const token = await this.tokens.token({ renew });
			const res = await this.fetcher(url, {
				...init,
				headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` }
			});
			if (res.ok) return res;
			if (res.status === 401 && !renew) {
				renew = true;
				continue;
			}
			let detail = res.statusText;
			try {
				const body = (await res.json()) as { error?: { message?: string } };
				detail = body.error?.message ?? detail;
			} catch {
				// Not JSON; the status text will do.
			}
			throw new DriveError(res.status, `Google Drive: ${res.status} ${detail}`);
		}
	}

	async download(fileId: string): Promise<Blob> {
		return (await this.send(downloadRequest(fileId))).blob();
	}

	/** The app's `TuneJournal/` folder, created on first use. drive.file sees only folders we made. */
	ensureFolder(name = APP_FOLDER): Promise<string> {
		this.#folder ??= (async () => {
			const list = (await (await this.send(findFolderRequest(name))).json()) as {
				files?: { id: string }[];
			};
			if (list.files?.[0]) return list.files[0].id;
			const created = (await (await this.send(createFolderRequest(name))).json()) as { id: string };
			return created.id;
		})();
		// A failure shouldn't stick.
		this.#folder.catch(() => (this.#folder = undefined));
		return this.#folder;
	}

	async upload(file: Blob, name: string): Promise<UploadedFile> {
		const folder = await this.ensureFolder();
		return (await this.send(uploadRequest(folder, file, name))).json() as Promise<UploadedFile>;
	}
}

// Browser-only: Google Identity Services and the Picker

/* eslint-disable @typescript-eslint/no-explicit-any */
const g = () => globalThis as any;
/* eslint-enable @typescript-eslint/no-explicit-any */

const scripts = new Map<string, Promise<void>>();

function loadScript(src: string): Promise<void> {
	let p = scripts.get(src);
	if (!p) {
		p = new Promise((resolve, reject) => {
			const s = document.createElement('script');
			s.src = src;
			s.async = true;
			s.onload = () => resolve();
			s.onerror = () => {
				scripts.delete(src);
				reject(new Error(`Couldn’t load ${src}`));
			};
			document.head.append(s);
		});
		scripts.set(src, p);
	}
	return p;
}

export function loadGis(): Promise<void> {
	return loadScript('https://accounts.google.com/gsi/client');
}

export async function loadPicker(): Promise<void> {
	await loadScript('https://apis.google.com/js/api.js');
	await new Promise<void>((resolve, reject) =>
		g().gapi.load('picker', { callback: resolve, onerror: reject })
	);
}

interface StoredToken {
	token: string;
	expiresAt: number;
}

const TOKEN_KEY = 'tunejournal.gdrive.token';
const CONSENT_KEY = 'tunejournal.gdrive.connected';
/** Treat a token as expired a minute early, so it doesn't lapse mid-request. */
const EXPIRY_MARGIN_MS = 60_000;

function readJson<T>(storage: Storage | undefined, key: string): T | undefined {
	try {
		const raw = storage?.getItem(key);
		return raw ? (JSON.parse(raw) as T) : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Access tokens from the GIS token client. Tokens last about an hour and are kept in
 * sessionStorage, so a reload doesn't need a new one. Whether the user has connected Drive on this
 * device is remembered in localStorage; a later token request then asks without the consent
 * screen. Requests should start from a click, or the browser may block Google's popup.
 */
export class GisTokenSource implements TokenSource {
	#cached?: StoredToken;

	constructor(
		readonly clientId: string,
		private readonly now: () => number = Date.now
	) {
		this.#cached = readJson<StoredToken>(globalThis.sessionStorage, TOKEN_KEY);
	}

	get connected(): boolean {
		try {
			return globalThis.localStorage?.getItem(CONSENT_KEY) === '1';
		} catch {
			return false;
		}
	}

	get hasValidToken(): boolean {
		return !!this.#cached && this.#cached.expiresAt - EXPIRY_MARGIN_MS > this.now();
	}

	async token({ renew = false }: { renew?: boolean } = {}): Promise<string> {
		if (!renew && this.hasValidToken) return this.#cached!.token;
		await loadGis();
		const fresh = await new Promise<StoredToken>((resolve, reject) => {
			const client = g().google.accounts.oauth2.initTokenClient({
				client_id: this.clientId,
				scope: DRIVE_FILE_SCOPE,
				callback: (r: {
					access_token?: string;
					expires_in?: number;
					error?: string;
					error_description?: string;
				}) => {
					if (r.error || !r.access_token)
						reject(new Error(r.error_description ?? r.error ?? 'No token'));
					else
						resolve({
							token: r.access_token,
							expiresAt: this.now() + (r.expires_in ?? 3600) * 1000
						});
				},
				error_callback: (e: { type: string; message?: string }) =>
					reject(
						new Error(
							e.type === 'popup_closed' ? 'Google sign-in was closed' : (e.message ?? e.type)
						)
					)
			});
			client.requestAccessToken({ prompt: this.connected ? '' : 'consent' });
		});
		this.#cached = fresh;
		try {
			globalThis.sessionStorage?.setItem(TOKEN_KEY, JSON.stringify(fresh));
			globalThis.localStorage?.setItem(CONSENT_KEY, '1');
		} catch {
			// Only a convenience.
		}
		return fresh.token;
	}

	/** Forgets the token and the connection on this device, and revokes the token. */
	disconnect() {
		const token = this.#cached?.token;
		this.#cached = undefined;
		try {
			globalThis.sessionStorage?.removeItem(TOKEN_KEY);
			globalThis.localStorage?.removeItem(CONSENT_KEY);
		} catch {
			// Nothing to forget.
		}
		if (token) g().google?.accounts?.oauth2?.revoke?.(token, () => {});
	}
}

export interface PickedFile {
	id: string;
	name: string;
	mimeType: string;
	sizeBytes?: number;
	durationSec?: number;
}

/** Opens the Picker on audio files. Resolves undefined when cancelled. */
export async function pickAudio(
	config: GoogleConfig,
	token: string
): Promise<PickedFile | undefined> {
	await loadPicker();
	const picker = g().google.picker;
	return new Promise((resolve) => {
		const view = new picker.DocsView(picker.ViewId.DOCS)
			.setMimeTypes(AUDIO_MIME_TYPES.join(','))
			.setIncludeFolders(true);
		new picker.PickerBuilder()
			.addView(view)
			.setOAuthToken(token)
			.setDeveloperKey(config.apiKey)
			// Picking a file grants drive.file access to it, scoped to this Cloud project.
			.setAppId(config.appId)
			.setCallback((r: { action: string; docs?: (PickedFile & { duration?: number })[] }) => {
				if (r.action === picker.Action.PICKED) {
					const doc = r.docs?.[0];
					resolve(
						doc && {
							id: doc.id,
							name: doc.name,
							mimeType: doc.mimeType,
							sizeBytes: doc.sizeBytes,
							// The Picker reports media duration in seconds for some files.
							durationSec: typeof doc.duration === 'number' ? doc.duration : undefined
						}
					);
				} else if (r.action === picker.Action.CANCEL) resolve(undefined);
			})
			.build()
			.setVisible(true);
	});
}
