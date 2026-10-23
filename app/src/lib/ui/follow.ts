// Notation that follows a preview (PLAN.md §6.3): while a setting plays in the picker, its row
// shows the couple of bars being played rather than the opening ones.
//
// The map comes from the same ABC and note sequence the synthesizer renders (abcjs' `setUpAudio`),
// so it follows repeats, endings and every time through exactly as heard. Each note carries the
// character position of its source in the ABC, which places it in a written measure (between two
// bar lines). The measures in the order they're played are grouped into windows of about two
// bars each, a pickup going with the bars after it, and a window's ABC is its measures' text,
// drawn as a little tune of its own. Times are tune seconds at 100%, as the player reports them.

import type { TuneObject } from 'abcjs';

/** A note as played: when (tune seconds at 100%) and where its source starts in the ABC. */
export interface ScoreNote {
	start: number;
	startChar: number;
}

/** A bar line in the ABC (abcjs' bar element): its text is `abc.slice(startChar, endChar)`. */
export interface BarMark {
	startChar: number;
	endChar: number;
}

/** A written measure as it's played. Measure `m` lies between bar lines `m - 1` and `m`. */
export interface PlayedBar {
	measure: number;
	start: number;
	end: number;
}

/** A stretch of the tune shown at once: about two bars, played from `start` to `end`. */
export interface BarWindow {
	start: number;
	end: number;
	measures: number[];
}

/** Everything needed to follow one tune: its ABC, notes, bar lines and windows. */
export interface ScoreMap {
	abc: string;
	/** `M`, `L` and `K` from the tune's header, for drawing a window on its own. */
	header: string;
	/** Where the tune body starts (after the header). */
	bodyStart: number;
	notes: ScoreNote[];
	bars: BarMark[];
	windows: BarWindow[];
	/** The measure each note is in. */
	noteMeasures: number[];
}

/** Which measure a character is in: the number of bar lines that end at or before it. */
export function measureOf(bars: readonly BarMark[], char: number): number {
	let lo = 0;
	let hi = bars.length;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (bars[mid].endChar <= char) lo = mid + 1;
		else hi = mid;
	}
	return lo;
}

/**
 * The measures in the order they're played, each from its first note to the next one's. A measure
 * played again (a repeat, the next time through) starts a new entry, even right after itself:
 * the notes going back in the text show it.
 */
export function playedBars(
	notes: readonly ScoreNote[],
	bars: readonly BarMark[],
	total: number
): PlayedBar[] {
	const played: PlayedBar[] = [];
	let lastChar = -1;
	for (const note of notes) {
		const measure = measureOf(bars, note.startChar);
		const current = played.at(-1);
		if (!current || current.measure !== measure || note.startChar < lastChar) {
			if (current) current.end = note.start;
			played.push({ measure, start: note.start, end: note.start });
		}
		lastChar = note.startChar;
	}
	const last = played.at(-1);
	if (last) last.end = Math.max(last.start, total);
	return played;
}

/**
 * Groups played measures into windows of `perWindow` bars (of `barSeconds` each) or a little more:
 * a short measure (a pickup, or the end of a part before the pickup into the next) counts for
 * what it lasts, so a pickup shares its window with the two bars after it and the windows stay
 * lined up with the phrases.
 */
export function barWindows(
	played: readonly PlayedBar[],
	barSeconds: number,
	perWindow = 2
): BarWindow[] {
	const windows: BarWindow[] = [];
	const target = perWindow * barSeconds - barSeconds * 0.1;
	let current: BarWindow | undefined;
	let length = 0;
	for (const bar of played) {
		if (!current) {
			current = { start: bar.start, end: bar.end, measures: [] };
			length = 0;
		}
		current.measures.push(bar.measure);
		current.end = bar.end;
		length += bar.end - bar.start;
		if (length >= target) {
			windows.push(current);
			current = undefined;
		}
	}
	if (current) windows.push(current);
	return windows;
}

/** The index of the window playing at `time` (the first before the start, the last after). */
export function windowAt(windows: readonly BarWindow[], time: number): number {
	let lo = 0;
	let hi = windows.length - 1;
	if (hi < 0) return -1;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if (windows[mid].start <= time + 1e-6) lo = mid;
		else hi = mid - 1;
	}
	return lo;
}

/** The index of the note sounding at `time`, or -1 before the first. */
export function noteAt(notes: readonly ScoreNote[], time: number): number {
	let lo = 0;
	let hi = notes.length - 1;
	let found = -1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		if (notes[mid].start <= time + 1e-6) {
			found = mid;
			lo = mid + 1;
		} else hi = mid - 1;
	}
	return found;
}

/** A bar line opening a window: no repeat end (`:|2` → `|2`, `::` → `|:`), no final bar. */
export function openingBar(text: string): string {
	const stripped = text.trim().replace(/^:+/, '');
	if (stripped === '') return '|:'; // `::` ends a repeat and starts the next
	if (stripped === '|]' || stripped === ']') return '|';
	return stripped;
}

/** A bar line closing a window: without the number of an ending that starts after it. */
export function closingBar(text: string): string {
	const t = text.trim().replace(/\s*\[?\d[\d,-]*$/, '');
	return t === '' ? '|' : t;
}

/** A measure's notes: the text between its bar lines, minus line breaks, fields and comments. */
function measureText(map: Pick<ScoreMap, 'abc' | 'bars' | 'bodyStart'>, measure: number): string {
	const from = measure > 0 ? map.bars[measure - 1].endChar : map.bodyStart;
	const to = measure < map.bars.length ? map.bars[measure].startChar : map.abc.length;
	return map.abc.slice(from, to);
}

function clean(text: string): string {
	return text
		.replace(/%[^\n]*/g, '')
		.replace(/(^|\n)\s*[A-Za-z]:[^\n]*/g, '$1')
		.replace(/\n/g, ' ');
}

/** A closing bar line followed by an opening one, as one: `:|` + `|:` → `:|:`, `|` + `|2` → `|2`. */
function joinBars(out: string, opener: string): string {
	if (out.endsWith('|') && opener.startsWith('|')) {
		return out.endsWith(':|') ? out + opener.slice(1) : out.slice(0, -1) + opener;
	}
	return out + opener;
}

export interface WindowAbc {
	abc: string;
	/** A character of the tune's ABC → the same one in this ABC, or -1 if it's not in it. */
	charAt(char: number): number;
}

/**
 * A window as a tune of its own: the header, then each measure with its bar lines. A measure that
 * doesn't follow the one before it in the text (after a repeat, or a jump to the second ending)
 * gets its own opening bar line, so a repeat sign or an ending number shows where it is.
 */
export function windowAbc(
	map: Pick<ScoreMap, 'abc' | 'bars' | 'bodyStart' | 'header'>,
	measures: readonly number[]
): WindowAbc {
	let out = map.header;
	const spans: { from: number; to: number; at: number }[] = [];
	measures.forEach((m, i) => {
		if (i === 0 || measures[i - 1] !== m - 1) {
			const opener = m > 0 ? map.bars[m - 1] : undefined;
			if (opener) out = joinBars(out, openingBar(map.abc.slice(opener.startChar, opener.endChar)));
		}
		const from = m > 0 ? map.bars[m - 1].endChar : map.bodyStart;
		const text = measureText(map, m);
		const cleaned = clean(text);
		// Cleaning keeps a note's place only when nothing before it changed length; map those.
		if (cleaned.length === text.length)
			spans.push({ from, to: from + text.length, at: out.length });
		out += cleaned;
		const closer = map.bars[m];
		if (closer) {
			const bar = map.abc.slice(closer.startChar, closer.endChar);
			out += measures[i + 1] === m + 1 ? bar : closingBar(bar);
		} else {
			out += '|]';
		}
	});
	return {
		abc: `${out}\n`,
		charAt(char) {
			const span = spans.find((s) => char >= s.from && char < s.to);
			return span ? span.at + (char - span.from) : -1;
		}
	};
}

/** The header lines worth keeping for a window: meter, note length and key. */
function windowHeader(abc: string): { header: string; bodyStart: number } {
	const lines = abc.split('\n');
	let at = 0;
	const kept: string[] = ['X:1'];
	for (const line of lines) {
		at += line.length + 1;
		if (/^[ML]:/.test(line)) kept.push(line);
		if (/^K:/.test(line)) {
			kept.push(line);
			return { header: `${kept.join('\n')}\n`, bodyStart: at };
		}
	}
	return { header: 'X:1\nK:C\n', bodyStart: 0 };
}

type Abcjs = Pick<typeof import('abcjs'), 'parseOnly'>;

interface SequenceNote {
	cmd: string;
	start: number;
	startChar?: number;
}

/**
 * Maps a whole tune (as the synthesizer renders it, `wholeNote` seconds to the whole note at
 * 100%) for following, with abcjs' parser: the note sequence it would play and its bar lines.
 */
export function scoreMap(abcjs: Abcjs, abc: string, wholeNote: number): ScoreMap | undefined {
	const [tune] = abcjs.parseOnly(abc) as TuneObject[];
	if (!tune || tune.lines.length === 0) return undefined;
	const bars: BarMark[] = [];
	for (const line of tune.lines) {
		const voice = line.staff?.[0]?.voices?.[0] ?? [];
		for (const el of voice as { el_type: string; startChar: number; endChar: number }[]) {
			if (el.el_type === 'bar') bars.push({ startChar: el.startChar, endChar: el.endChar });
		}
	}
	const sequence = tune.setUpAudio({ chordsOff: true }) as unknown as {
		tracks: SequenceNote[][];
		totalDuration: number;
	};
	const track = sequence.tracks.find((t) => t.some((e) => e.cmd === 'note')) ?? [];
	const notes = track
		.filter((e) => e.cmd === 'note' && e.startChar !== undefined)
		.map((e) => ({ start: e.start * wholeNote, startChar: e.startChar! }))
		.sort((a, b) => a.start - b.start);
	if (notes.length === 0) return undefined;
	const meter = tune.getMeterFraction();
	const barSeconds = ((meter.num ?? 4) / (meter.den ?? 4) || 1) * wholeNote;
	const played = playedBars(notes, bars, sequence.totalDuration * wholeNote);
	const { header, bodyStart } = windowHeader(abc);
	return {
		abc,
		header,
		bodyStart,
		notes,
		bars,
		windows: barWindows(played, barSeconds),
		noteMeasures: notes.map((n) => measureOf(bars, n.startChar))
	};
}
