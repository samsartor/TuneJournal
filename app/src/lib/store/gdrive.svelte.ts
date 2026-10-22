// Google Drive for the UI. The Google Cloud settings (OAuth client ID, API key, project number) come
// from Settings → Google Drive, saved on this device only (localStorage, never the synced doc), or
// else from the PUBLIC_GOOGLE_* values baked in at build time. Drive UI stays hidden until all
// three are known, and appears as soon as they're saved, without a rebuild.
// "Connected" means the user granted drive.file on this device once; tokens are re-requested
// (usually without a consent screen) when they expire.

import {
	PUBLIC_GOOGLE_API_KEY,
	PUBLIC_GOOGLE_APP_ID,
	PUBLIC_GOOGLE_CLIENT_ID
} from '$app/env/public';
import {
	CONFIG_FIELDS,
	DriveClient,
	GisTokenSource,
	findFolderRequest,
	isConfigured,
	mergeConfig,
	readDeviceConfig,
	writeDeviceConfig,
	pickAudio,
	type GoogleConfig,
	type PickedFile,
	type UploadedFile
} from '#lib/integrations/gdrive.ts';

export const BUILD_CONFIG: Partial<GoogleConfig> = {
	clientId: PUBLIC_GOOGLE_CLIENT_ID,
	apiKey: PUBLIC_GOOGLE_API_KEY,
	appId: PUBLIC_GOOGLE_APP_ID
};

class GDriveStore {
	/** What's saved on this device (may be partial). Empty where there's no localStorage. */
	device = $state<Partial<GoogleConfig>>(readDeviceConfig());
	readonly build = BUILD_CONFIG;
	readonly config = $derived(mergeConfig(this.device, this.build));
	readonly configured = $derived(isConfigured(this.config));
	/** Where the settings in use come from. */
	readonly origin = $derived<'device' | 'build' | 'none'>(
		!this.configured ? 'none' : CONFIG_FIELDS.some((f) => this.device[f]) ? 'device' : 'build'
	);
	connected = $state(false);

	#tokens?: GisTokenSource;
	#client?: DriveClient;

	get #source(): GisTokenSource {
		if (!this.configured)
			throw new Error('Google Drive isn’t set up yet (Settings → Google Drive)');
		const clientId = this.config.clientId!;
		if (this.#tokens?.clientId !== clientId) {
			this.#tokens = new GisTokenSource(clientId);
			this.#client = undefined;
		}
		return this.#tokens;
	}

	get client(): DriveClient {
		const source = this.#source;
		this.#client ??= new DriveClient(source);
		return this.#client;
	}

	/** Reads this device's settings and whether it connected Drive before. Browser only. */
	init() {
		this.device = readDeviceConfig();
		this.connected = this.configured && this.#source.connected;
	}

	/**
	 * Saves settings on this device (blank fields fall back to the build's). Changing the client ID
	 * forgets the old connection, since its tokens belong to the other client.
	 */
	saveDeviceConfig(next: Partial<GoogleConfig>) {
		const before = this.config.clientId;
		this.device = writeDeviceConfig(next);
		if (this.config.clientId !== before) {
			this.#tokens?.disconnect();
			this.#tokens = undefined;
			this.#client = undefined;
			this.connected = false;
		}
	}

	clearDeviceConfig() {
		this.saveDeviceConfig({});
	}

	async connect(): Promise<void> {
		await this.#source.token();
		this.connected = true;
	}

	disconnect() {
		this.#tokens?.disconnect();
		this.connected = false;
	}

	/**
	 * Signs in (a Google popup the first time) and lists the app's folder, which proves the client
	 * ID, this origin and the Drive API all work. The API key and project number are only used by
	 * the file picker, so they're checked when a file is picked.
	 */
	async test(): Promise<void> {
		await this.client.send(findFolderRequest());
		this.connected = true;
	}

	/** Opens the Picker. Asks for a token first if needed. */
	async pick(): Promise<PickedFile | undefined> {
		const token = await this.#source.token();
		this.connected = true;
		return pickAudio(this.config as GoogleConfig, token);
	}

	download(fileId: string): Promise<Blob> {
		return this.client.download(fileId);
	}

	async upload(file: Blob, name: string): Promise<UploadedFile> {
		const result = await this.client.upload(file, name);
		this.connected = true;
		return result;
	}
}

export const gdrive = new GDriveStore();
