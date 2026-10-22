import type { HandleClientError } from '@sveltejs/kit/hooks';

// Everything runs in the user's own browser (there's no server to hide details from), so an
// unexpected error's own message is shown on the error page instead of "Internal Error".
export const handleError: HandleClientError = (input) => {
	if (input.kind !== 'unknown') return;
	console.error(input.error);
	const error = input.error;
	const message = error instanceof Error ? error.message : String(error);
	return { message: message || 'Internal Error' };
};
