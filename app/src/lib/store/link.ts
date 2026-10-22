import {
	isValidAutomergeUrl,
	parseAutomergeUrl,
	stringifyAutomergeUrl,
	type AutomergeUrl
} from '@automerge/automerge-repo/slim';

const PREFIX = 'automerge:';

/**
 * Reads a library address from whatever the user pasted or scanned: a bare `automerge:` URL, or a
 * link-device deep link (`https://…/link-device#automerge:…`). Heads pinned in the URL are dropped,
 * since a device should follow the live library rather than a fixed snapshot of it.
 */
export function parseLibraryLink(input: string | null | undefined): AutomergeUrl | undefined {
	let text = input?.trim();
	if (!text) return undefined;
	// A deep link carries the address in its hash, possibly percent-encoded.
	if (!text.startsWith(PREFIX)) {
		const hash = text.indexOf('#');
		if (hash < 0) return undefined;
		try {
			text = decodeURIComponent(text.slice(hash + 1));
		} catch {
			return undefined;
		}
	}
	const [base] = text.split('#');
	if (!base.startsWith(PREFIX) || !isValidAutomergeUrl(base)) return undefined;
	return stringifyAutomergeUrl({ documentId: parseAutomergeUrl(base).documentId });
}

/** The deep link a QR code encodes: the link-device page, with the library address as its hash. */
export function libraryDeepLink(linkDevicePage: string | URL, url: AutomergeUrl): string {
	const link = new URL(linkDevicePage);
	link.search = '';
	link.hash = url;
	return link.href;
}
