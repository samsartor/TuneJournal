import type { PieceKind, Skill, SortField, Timestamp } from './types.ts';

export const KINDS: PieceKind[] = ['tune', 'set', 'part', 'session'];

export const KIND_LABEL: Record<PieceKind, string> = {
	session: 'Session',
	set: 'Set',
	tune: 'Tune',
	part: 'Part'
};

export const KIND_PLURAL: Record<PieceKind, string> = {
	session: 'Sessions',
	set: 'Sets',
	tune: 'Tunes',
	part: 'Parts'
};

export const SKILL_LABEL: Record<Skill, string> = {
	1: 'Never played',
	2: 'Learning',
	3: 'Getting there',
	4: 'Solid',
	5: 'Amazing'
};

export const SORT_LABEL: Record<SortField, string> = {
	title: 'Title',
	created: 'Created',
	modified: 'Modified',
	lastPracticed: 'Last practiced',
	timesPracticed: 'Times practiced',
	skill: 'Skill'
};

export function untitled(kind: PieceKind): string {
	return `Untitled ${KIND_LABEL[kind].toLowerCase()}`;
}

const DAY = 24 * 60 * 60 * 1000;

/** "just now", "5 minutes ago", "yesterday", "3 days ago", "2 weeks ago", "4 months ago". */
export function relativeTime(at: Timestamp, now: Timestamp, locale?: string): string {
	const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
	const diff = Math.max(0, now - at);
	const minutes = Math.floor(diff / 60_000);
	if (minutes < 1) return 'just now';
	if (minutes < 60) return rtf.format(-minutes, 'minute');
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return rtf.format(-hours, 'hour');
	const days = Math.floor(diff / DAY);
	if (days < 7) return rtf.format(-days, 'day');
	if (days < 30) return rtf.format(-Math.floor(days / 7), 'week');
	if (days < 365) return rtf.format(-Math.floor(days / 30), 'month');
	return rtf.format(-Math.floor(days / 365), 'year');
}
