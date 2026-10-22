import type { DocHandle } from '@automerge/automerge-repo';
import type { Library } from '#lib/domain/types.ts';
import { openLibrary } from './repo';

type Status = 'idle' | 'loading' | 'ready' | 'error';

class LibraryStore {
	// Automerge docs are immutable snapshots, so swap them wholesale rather than deep-proxying.
	doc = $state.raw<Library>();
	url = $state<string>();
	status = $state<Status>('idle');
	error = $state.raw<unknown>();

	#handle?: DocHandle<Library>;

	async load() {
		if (this.status !== 'idle') return;
		this.status = 'loading';
		try {
			const handle = await openLibrary();
			this.#handle = handle;
			this.url = handle.url;
			this.doc = handle.doc();
			handle.on('change', ({ doc }) => (this.doc = doc));
			this.status = 'ready';
		} catch (e) {
			console.error('Failed to open library', e);
			this.error = e;
			this.status = 'error';
		}
	}

	change(fn: (lib: Library) => void) {
		if (!this.#handle) throw new Error('Library is not loaded');
		this.#handle.change(fn);
	}
}

export const library = new LibraryStore();
