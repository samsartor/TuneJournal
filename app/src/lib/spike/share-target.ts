// Spike: receives Web Share Target POSTs in the service worker (see static/manifest.webmanifest).
// Lib-agnostic so it type-checks under both the DOM and WebWorker libs.

import { putFile } from './file-store.ts';

/** Must match `share_target.action` in the manifest, relative to the scope. */
export const SHARE_ACTION = 'spike/share-target';
export const SHARE_PAGE = 'spike/share';
export const SHARE_DIR = 'shared';

export function isShareTarget(request: Request, scope: string): boolean {
	return (
		request.method === 'POST' && request.url.split('?')[0] === new URL(SHARE_ACTION, scope).href
	);
}

const safe = (name: string) => name.replace(/[^\w.\- ]+/g, '_').slice(-100) || 'file';

export async function handleShareTarget(request: Request, scope: string): Promise<Response> {
	const page = new URL(SHARE_PAGE, scope);
	try {
		const form = await request.formData();
		const stamp = Date.now();
		let count = 0;
		const backends = new Set<string>();
		// Sequential, since the OPFS type sidecar file is read-modify-write.
		for (const entry of form.getAll('audio')) {
			if (typeof entry === 'string') continue;
			backends.add(await putFile(SHARE_DIR, `${stamp}-${count}-${safe(entry.name)}`, entry));
			count++;
		}
		// Some apps (Recorder's "share link") send text or a URL instead of a file. Keep those too.
		const text = ['title', 'text', 'url']
			.map((k) => [k, form.get(k)])
			.filter(([, v]) => typeof v === 'string' && v)
			.map(([k, v]) => `${k}: ${v}`)
			.join('\n');
		if (text) {
			const blob = new Blob([text], { type: 'text/plain' });
			backends.add(await putFile(SHARE_DIR, `${stamp}-meta.txt`, blob));
		}
		page.searchParams.set('received', String(count));
		page.searchParams.set('backend', [...backends].join(','));
	} catch (e) {
		page.searchParams.set('error', String(e));
	}
	// 303 turns the POST into a GET navigation, which the app shell then serves.
	return Response.redirect(page.href, 303);
}
