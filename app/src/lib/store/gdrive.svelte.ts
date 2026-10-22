// Google Drive for the UI: hidden entirely unless PUBLIC_GOOGLE_* is configured at build time.
// "Connected" means the user granted drive.file on this device once; tokens are re-requested
// (usually without a consent screen) when they expire.

import {
	PUBLIC_GOOGLE_API_KEY,
	PUBLIC_GOOGLE_APP_ID,
	PUBLIC_GOOGLE_CLIENT_ID
} from '$app/env/public';
import {
	DriveClient,
	GisTokenSource,
	isConfigured,
	pickAudio,
	type GoogleConfig,
	type PickedFile,
	type UploadedFile
} from '#lib/integrations/gdrive.ts';

class GDriveStore {
	readonly config: Partial<GoogleConfig> = {
		clientId: PUBLIC_GOOGLE_CLIENT_ID,
		apiKey: PUBLIC_GOOGLE_API_KEY,
		appId: PUBLIC_GOOGLE_APP_ID
	};
	readonly configured = isConfigured(this.config);
	connected = $state(false);

	#tokens?: GisTokenSource;
	#client?: DriveClient;

	get #source(): GisTokenSource {
		if (!this.configured) throw new Error('Google Drive isn’t set up for this app');
		this.#tokens ??= new GisTokenSource(this.config.clientId!);
		return this.#tokens;
	}

	get client(): DriveClient {
		this.#client ??= new DriveClient(this.#source);
		return this.#client;
	}

	/** Reads whether this device connected Drive before. Call from the browser only. */
	init() {
		if (this.configured) this.connected = this.#source.connected;
	}

	async connect(): Promise<void> {
		await this.#source.token();
		this.connected = true;
	}

	disconnect() {
		this.#tokens?.disconnect();
		this.connected = false;
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
