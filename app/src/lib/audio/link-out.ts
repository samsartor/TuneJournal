// Sources we can only link to (Spotify, thesession, FolkFriend, other pages): "playing" opens the
// URL in a new tab (PLAN.md §6.6). The recordings list renders these as plain ↗ links, which is
// better for accessibility and popup blockers; this adapter lets callers like Shuffle treat every
// clip alike.

import {
	Listeners,
	type PlayableClip,
	type PlayerAdapter,
	type PlayerSnapshot
} from './adapter.ts';

export class LinkOutAdapter implements PlayerAdapter {
	readonly kind = 'link' as const;
	#url?: string;
	#listeners = new Listeners<PlayerSnapshot>();

	constructor(private readonly open: (url: string) => void = defaultOpen) {}

	async load(clip: PlayableClip): Promise<void> {
		this.#url = clip.url;
		this.#listeners.emit({ time: 0, playing: false });
	}

	async play(): Promise<void> {
		if (this.#url) this.open(this.#url);
	}

	pause(): void {}
	seek(): void {}
	setRate(): void {}
	setLoop(): void {}
	setBounds(): void {}
	setPitchShift(): void {}

	onTime(listener: (snapshot: PlayerSnapshot) => void): () => void {
		return this.#listeners.add(listener);
	}

	destroy(): void {
		this.#listeners.clear();
	}
}

function defaultOpen(url: string) {
	window.open(url, '_blank', 'noopener,noreferrer');
}
