// Clip-bound and speed math for the player (PLAN.md §6.6). Pure, so it's unit-tested and shared by
// every adapter.

export interface Bounds {
	/** Seconds. */
	start: number;
	/** Seconds; Infinity while the media's duration isn't known and the clip has no end. */
	end: number;
}

export interface Trim {
	start?: number;
	end?: number;
}

/**
 * The playable range of a clip in media of `duration` seconds: the clip's start/end, clamped to
 * the media. A trim that falls outside the media (or is inverted) falls back to the whole thing.
 */
export function clipBounds(clip: Trim, duration?: number): Bounds {
	const known = duration !== undefined && Number.isFinite(duration) && duration > 0;
	const max = known ? duration : Infinity;
	let start = Math.max(0, clip.start ?? 0);
	let end = Math.min(clip.end ?? max, max);
	if (start >= max) start = 0;
	if (end <= start) end = max;
	return { start, end };
}

export function clampTime(time: number, b: Bounds): number {
	return Math.min(Math.max(time, b.start), b.end);
}

/** How close to the end counts as "at the end": one timeupdate tick at most speeds. */
export const END_EPSILON = 0.05;

/**
 * What to do at `time` while playing: keep going, jump back to the start (loop), or stop at the
 * end.
 */
export function endAction(time: number, b: Bounds, loop: boolean): 'continue' | 'loop' | 'stop' {
	if (!Number.isFinite(b.end) || time < b.end - END_EPSILON) return 'continue';
	return loop ? 'loop' : 'stop';
}

/** Where pressing play should start from: the current time, unless it's outside the clip. */
export function playFrom(time: number, b: Bounds): number {
	return time < b.start || time >= b.end - END_EPSILON ? b.start : time;
}

/** 0–1 through the clip, for a progress bar. */
export function progress(time: number, b: Bounds): number {
	if (!Number.isFinite(b.end) || b.end <= b.start) return 0;
	return Math.min(1, Math.max(0, (time - b.start) / (b.end - b.start)));
}

// Speed

export const SPEED_PRESETS = [0.5, 0.6, 0.75, 0.9, 1] as const;
export const SPEED_STEP = 0.05;
/** YouTube supports 0.25–2; Firefox mutes <audio> outside 0.25–4. */
export const SPEED_MIN = 0.25;
export const SPEED_MAX = 2;

/** Rounds to the nearest 0.01 and keeps it in range. NaN becomes 1. */
export function clampRate(rate: number): number {
	if (!Number.isFinite(rate)) return 1;
	return Math.min(SPEED_MAX, Math.max(SPEED_MIN, Math.round(rate * 100) / 100));
}

/** One ±5% step, snapping to the 5% grid first (0.92 + step → 0.95). */
export function stepRate(rate: number, direction: 1 | -1): number {
	const k = rate / SPEED_STEP;
	const next = direction > 0 ? Math.floor(k + 1e-6) + 1 : Math.ceil(k - 1e-6) - 1;
	return clampRate(next * SPEED_STEP);
}

export function formatRate(rate: number): string {
	return `${Math.round(rate * 100)}%`;
}

// Time

/** "0:05", "1:05", "1:02:03". Rounds down to whole seconds unless `decimals` is given. */
export function formatTime(seconds: number, decimals = 0): string {
	if (!Number.isFinite(seconds) || seconds < 0) return '–:––';
	const factor = 10 ** decimals;
	const total = Math.floor(seconds * factor + 1e-6) / factor;
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	const sec = (decimals ? s.toFixed(decimals) : String(Math.floor(s))).padStart(
		decimals ? 3 + decimals : 2,
		'0'
	);
	return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** Parses "75", "1:15", "1:15.5" or "1:02:03" into seconds. */
export function parseTime(text: string): number | undefined {
	const parts = text.trim().split(':');
	if (parts.length > 3 || parts.some((p) => !/^\d+(?:\.\d+)?$/.test(p))) return undefined;
	return parts.reduce((total, p) => total * 60 + Number(p), 0);
}

/** "0:12–0:45" for a trimmed clip, or undefined when it isn't trimmed. */
export function trimLabel(clip: Trim, duration?: number): string | undefined {
	if (clip.start === undefined && clip.end === undefined) return undefined;
	const end = clip.end ?? duration;
	return `${formatTime(clip.start ?? 0)}–${end === undefined ? 'end' : formatTime(end)}`;
}
