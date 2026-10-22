import { defineEnvVars } from '@sveltejs/kit/env';

// Build-time public config, read from `.env` (see .env.example). Import from `$app/env/public`.
// All optional: the integrations that need them show a setup hint when they're empty.
const optional = (value: string | undefined) => value ?? '';

const DEFAULT_SYNC_URL = 'wss://sync.automerge.org';

export const variables = defineEnvVars({
	PUBLIC_SYNC_URL: {
		public: true,
		static: true,
		schema: (value) => {
			const url = value?.trim() || DEFAULT_SYNC_URL;
			if (!/^wss?:\/\//.test(url)) throw new Error('PUBLIC_SYNC_URL must be a ws:// or wss:// URL');
			return url;
		},
		description: 'WebSocket URL of the automerge-repo sync relay. Defaults to the public relay.'
	},
	PUBLIC_GOOGLE_CLIENT_ID: {
		public: true,
		static: true,
		schema: optional,
		description: 'OAuth 2.0 web client ID for Google Identity Services.'
	},
	PUBLIC_GOOGLE_API_KEY: {
		public: true,
		static: true,
		schema: optional,
		description: 'Browser API key, restricted to the Picker API and our origins.'
	},
	PUBLIC_GOOGLE_APP_ID: {
		public: true,
		static: true,
		schema: optional,
		description: 'Google Cloud project number, which the Picker uses as the app ID.'
	}
});
