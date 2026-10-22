import { defineEnvVars } from '@sveltejs/kit/env';

// Build-time public config, read from `.env` (see .env.example). Import from `$app/env/public`.
// All optional: the integrations that need them show a setup hint when they're empty.
const optional = (value: string | undefined) => value ?? '';

export const variables = defineEnvVars({
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
