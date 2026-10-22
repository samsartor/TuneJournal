// Labels for inherited values (PLAN.md §5): a piece's key or first notes can come from one of its
// recordings or, for a Part's key, from its Tune. Shown muted with "from <name>".

import type { ValueOrigin } from '#lib/domain/derived.ts';
import { untitled } from '#lib/domain/format.ts';
import { recordingTitle } from '#lib/domain/providers.ts';
import { oembed } from '#lib/store/oembed.svelte.ts';

/** What a value is inherited from, or undefined for the piece's own value. */
export function originName(origin: ValueOrigin | undefined): string | undefined {
	switch (origin?.from) {
		case 'clip':
			return recordingTitle(origin.clip, origin.source, oembed.lookup(origin.source)?.title);
		case 'tune':
			return origin.tune.title ?? untitled(origin.tune.kind);
		default:
			return undefined;
	}
}
