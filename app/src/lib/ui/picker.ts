// Pure helpers for the thesession.org tune and setting pickers (PLAN.md §6.3): what a search
// result or a setting shows (meter, keys, who posted it and when), and the short ABC drawn as a
// setting's incipit.

import { foldText } from '#lib/domain/derived.ts';
import { formatKey, normalizeKey } from '#lib/domain/key.ts';
import { TUNE_TYPES, abcKey } from '#lib/domain/synth.ts';
import { firstBars, type Tune, type TuneSetting } from '#lib/integrations/thesession.ts';

/** A tune type's usual meter ("reel" → "4/4"), or undefined for a type we don't know. */
export function typeMeter(type: string | undefined): string | undefined {
	const key = (type ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
	return TUNE_TYPES[key]?.meter;
}

/** A setting's key for display: "Edorian" → "E dor"; text we can't read stays as it is. */
export function settingKeyLabel(key: string): string {
	const k = normalizeKey(key);
	return k ? formatKey(k) : key;
}

/** Distinct keys across settings, most common first: [["E dor", 29], ["E min", 3]]. */
export function keyCounts(settings: readonly Pick<TuneSetting, 'key'>[]): [string, number][] {
	const counts = new Map<string, number>();
	for (const s of settings) {
		const label = settingKeyLabel(s.key);
		counts.set(label, (counts.get(label) ?? 0) + 1);
	}
	return [...counts].sort((a, b) => b[1] - a[1]);
}

const numbers = new Intl.NumberFormat('en');

/** A loaded tune at a glance: "3 settings (E min ×2, E dor) · 6,826 tunebooks". */
export function tuneSummary(tune: Pick<Tune, 'settings' | 'tunebooks'>): string {
	const n = tune.settings.length;
	const keys = keyCounts(tune.settings)
		.slice(0, 3)
		.map(([k, count]) => (count > 1 ? `${k} ×${count}` : k));
	const settings = `${n} ${n === 1 ? 'setting' : 'settings'}${keys.length ? ` (${keys.join(', ')})` : ''}`;
	const books = `${numbers.format(tune.tunebooks)} ${tune.tunebooks === 1 ? 'tunebook' : 'tunebooks'}`;
	return `${settings} · ${books}`;
}

/**
 * A tune's other names worth showing: its aliases minus the name itself, the alias the search
 * matched (shown already) and spellings that differ only in punctuation or case.
 */
export function otherNames(name: string, aliases: readonly string[], matched?: string): string[] {
	const seen = new Set([foldText(name), ...(matched ? [foldText(matched)] : [])]);
	return aliases.filter((alias) => {
		const folded = foldText(alias);
		if (!folded || seen.has(folded)) return false;
		seen.add(folded);
		return true;
	});
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * thesession's "2001-05-14 18:45:18" as "14 May 2001". Read as written, with no time zone, so it
 * never shifts a day. Anything else gives undefined.
 */
export function formatPostedDate(date: string | undefined): string | undefined {
	const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date ?? '');
	if (!m) return undefined;
	const month = MONTHS[Number(m[2]) - 1];
	const day = Number(m[3]);
	if (!month || day < 1 || day > 31) return undefined;
	return `${day} ${month} ${m[1]}`;
}

/** "Posted by Jeremy, 14 May 2001", with whichever parts are known. */
export function postedBy(setting: Pick<TuneSetting, 'member' | 'date'>): string | undefined {
	const who = setting.member?.name?.trim();
	const when = formatPostedDate(setting.date);
	if (who && when) return `${who}, ${when}`;
	return who || when;
}

/**
 * A tiny tune for drawing a setting's opening bars: meter from the type, the setting's key, and the
 * first `bars` bars (a pickup kept, as in first notes).
 */
export function incipitAbc(
	setting: Pick<TuneSetting, 'abc' | 'key'>,
	type: string | undefined,
	bars = 2
): string {
	const notes = firstBars(setting.abc, bars);
	const meter = typeMeter(type) ?? '4/4';
	return `X:1\nM:${meter}\nL:1/8\nK:${abcKey(setting.key)}\n${notes} |]\n`;
}
