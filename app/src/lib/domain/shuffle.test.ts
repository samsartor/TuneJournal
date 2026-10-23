// Shuffle: candidates, features, and the seeded Gumbel-top-k order (PLAN.md §6.5, §12, §14).

import { describe, expect, it } from 'vitest';
import * as Automerge from '@automerge/automerge';
import { buildIndex } from './derived';
import { emptyLibrary } from './library';
import { createPiece, logPractice, setShuffleSettings, updatePiece, type PiecePatch } from './ops';
import { linkPieces } from './relations';
import {
	SLIDER_STEPS,
	T_MAX,
	T_MIN,
	features,
	gumbel,
	hash53,
	newSeed,
	parseSession,
	pieceUniform,
	sessionOrder,
	sessionQuery,
	shuffleCandidates,
	shuffleFingerprint,
	shuffleOrder,
	sliderPosition,
	temperatureAt,
	toCandidate,
	weights,
	type Candidate,
	type ShuffleSettings
} from './shuffle';
import type { Library, PieceId, PieceKind } from './types';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1000 * DAY;

const OFF = { tAge: null, tSkill: null, tFav: null };

function settings(patch: Partial<ShuffleSettings> = {}): ShuffleSettings {
	return {
		...emptyLibrary().settings.shuffle,
		...patch
	};
}

function add(
	lib: Library,
	title: string,
	opts: PiecePatch & { practiced?: number[] } = {}
): PieceId {
	const { practiced = [], ...patch } = opts;
	const id = createPiece(lib, { title, now: 0 });
	updatePiece(lib, id, patch, 0);
	for (const at of practiced) logPractice(lib, id, { now: at });
	return id;
}

let nextId = 0;
function candidate(patch: Partial<Candidate> = {}): Candidate {
	return {
		piece: { id: `c${nextId++}` } as never,
		timesPracticed: 0,
		favorite: false,
		...patch
	};
}

type Temps = Pick<ShuffleSettings, 'tAge' | 'tSkill' | 'tFav'>;
const SEEDS = (n: number) => Array.from({ length: n }, (_, k) => `s${k.toString(36)}`);

/** How often each candidate comes up at `position` over `n` seeds. */
function tally(cands: Candidate[], s: Temps, n: number, position = 0) {
	const counts = new Map<Candidate, number>(cands.map((c) => [c, 0]));
	for (const seed of SEEDS(n)) {
		const c = shuffleOrder(cands, s, seed, NOW)[position].candidate;
		counts.set(c, counts.get(c)! + 1);
	}
	return cands.map((c) => counts.get(c)!);
}

function chiSquare(counts: number[], expected: number[]) {
	return counts.reduce((sum, c, k) => sum + (c - expected[k]) ** 2 / expected[k], 0);
}

describe('features', () => {
	it('staleness grows with days since practice and caps at the horizon', () => {
		expect(features(candidate(), NOW).age).toBe(1);
		expect(features(candidate({ lastPracticed: NOW }), NOW).age).toBe(0);
		expect(features(candidate({ lastPracticed: NOW - 30 * DAY }), NOW).age).toBeCloseTo(0.5);
		expect(features(candidate({ lastPracticed: NOW - 365 * DAY }), NOW).age).toBe(1);
		expect(
			features(candidate({ lastPracticed: NOW - 5 * DAY }), NOW, { horizonDays: 10 }).age
		).toBeCloseTo(0.5);
		// A clock that's slightly behind another device's practice entry.
		expect(features(candidate({ lastPracticed: NOW + DAY }), NOW).age).toBe(0);
	});

	it('weakness is (5 - skill) / 4, and unrated counts as 1', () => {
		expect(features(candidate(), NOW).skill).toBe(1);
		expect(features(candidate({ skill: 1 }), NOW).skill).toBe(1);
		expect(features(candidate({ skill: 3 }), NOW).skill).toBe(0.5);
		expect(features(candidate({ skill: 5 }), NOW).skill).toBe(0);
	});

	it('affinity is half favorite, half log-scaled practice count', () => {
		expect(features(candidate(), NOW).fav).toBe(0);
		expect(features(candidate({ favorite: true }), NOW).fav).toBe(0.5);
		expect(features(candidate({ timesPracticed: 20 }), NOW).fav).toBeCloseTo(0.5);
		expect(features(candidate({ timesPracticed: 500, favorite: true }), NOW).fav).toBe(1);
		const some = features(candidate({ timesPracticed: 3 }), NOW).fav;
		expect(some).toBeCloseTo((0.5 * Math.log(4)) / Math.log(21));
	});
});

describe('order (Gumbel-top-k)', () => {
	it('at a tiny age temperature puts the stalest piece first at least 99% of the time', () => {
		const cands = [
			candidate({ lastPracticed: NOW - 50 * DAY }),
			candidate({ lastPracticed: NOW - 25 * DAY }),
			candidate({ lastPracticed: NOW - 2 * DAY }),
			candidate({ lastPracticed: NOW - 40 * DAY })
		];
		for (const tAge of [0.01, 1e-9]) {
			const counts = tally(cands, { ...OFF, tAge }, 2000);
			expect(counts[0] / 2000).toBeGreaterThanOrEqual(0.99);
		}
		// The slider's lowest notch is decisive once the gap is a fair share of the horizon.
		const spread = [
			candidate(),
			candidate({ lastPracticed: NOW - 30 * DAY }),
			candidate({ lastPracticed: NOW - 2 * DAY })
		];
		expect(tally(spread, { ...OFF, tAge: T_MIN }, 2000)[0] / 2000).toBeGreaterThanOrEqual(0.99);
		// And at 1e-9 the whole order is by staleness.
		const order = shuffleOrder(cands, { ...OFF, tAge: 1e-9 }, 'x', NOW).map((r) => r.candidate);
		expect(order).toEqual([cands[0], cands[3], cands[1], cands[2]]);
	});

	it('first and second places follow sequential softmax sampling', () => {
		// Ages 1, 0.5, 0.25, 0 at T = 0.5: logits 2, 1, 0.5, 0.
		const cands = [
			candidate(),
			candidate({ lastPracticed: NOW - 30 * DAY }),
			candidate({ lastPracticed: NOW - 15 * DAY }),
			candidate({ lastPracticed: NOW })
		];
		const temps = { ...OFF, tAge: 0.5 };
		const p = weights(cands, temps, NOW).map((w) => w.p);
		const z = Math.exp(2) + Math.exp(1) + Math.exp(0.5) + 1;
		expect(p[0]).toBeCloseTo(Math.exp(2) / z, 12);

		const n = 20000;
		const first = tally(cands, temps, n, 0);
		// Chi-square with 3 degrees of freedom: 16.27 is the 0.1% critical value.
		expect(
			chiSquare(
				first,
				p.map((q) => q * n)
			)
		).toBeLessThan(16.27);

		// P(second = j) = sum over k != j of p_k * p_j / (1 - p_k).
		const second = p.map((pj, j) =>
			p.reduce((sum, pk, k) => (k === j ? sum : sum + (pk * pj) / (1 - pk)), 0)
		);
		expect(second.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
		const seen = tally(cands, temps, n, 1);
		expect(
			chiSquare(
				seen,
				second.map((q) => q * n)
			)
		).toBeLessThan(16.27);
	});

	it('is a uniform permutation with every temperature at ∞', () => {
		const cands = [
			candidate({ lastPracticed: NOW, skill: 5, favorite: true, timesPracticed: 50 }),
			candidate({ skill: 1 }),
			candidate({ lastPracticed: NOW - 10 * DAY, skill: 3 }),
			candidate({ favorite: true })
		];
		for (const w of weights(cands, OFF, NOW)) expect(w.p).toBeCloseTo(0.25, 12);

		// All 24 orders of 4 pieces, about equally often over 24 000 seeds.
		const n = 24000;
		const counts = new Map<string, number>();
		for (const seed of SEEDS(n)) {
			const key = shuffleOrder(cands, OFF, seed, NOW)
				.map((r) => cands.indexOf(r.candidate))
				.join('');
			counts.set(key, (counts.get(key) ?? 0) + 1);
		}
		expect(counts.size).toBe(24);
		// Chi-square with 23 degrees of freedom: 49.73 is the 0.1% critical value.
		const values = [...counts.values()];
		expect(
			chiSquare(
				values,
				values.map(() => n / 24)
			)
		).toBeLessThan(49.73);
	});

	it('at a tiny skill temperature puts the weakest piece first; unrated counts as weakest', () => {
		const cands = [
			candidate({ skill: 4 }),
			candidate({ skill: 2 }),
			candidate({ skill: 5 }),
			candidate({ skill: 3 })
		];
		const counts = tally(cands, { ...OFF, tSkill: T_MIN }, 2000);
		expect(counts[1] / 2000).toBeGreaterThanOrEqual(0.99);

		// Unrated and skill 1 tie as the weakest; both beat skill 2.
		const unrated = [candidate({ skill: 2 }), candidate(), candidate({ skill: 1 })];
		const w = weights(unrated, { ...OFF, tSkill: 0.01 }, NOW);
		expect(w[1].p).toBeCloseTo(0.5, 6);
		expect(w[2].p).toBeCloseTo(0.5, 6);
		expect(w[0].p).toBeLessThan(1e-6);
		const firsts = tally(unrated, { ...OFF, tSkill: 0.01 }, 2000);
		expect(firsts[0]).toBe(0);
		expect(Math.abs(firsts[1] - 1000)).toBeLessThan(150);
	});

	it('at a tiny favorite temperature puts the most-loved piece first', () => {
		const cands = [
			candidate({ favorite: true, timesPracticed: 2 }),
			candidate({ timesPracticed: 30 }),
			candidate({ favorite: true, timesPracticed: 40 }),
			candidate()
		];
		const counts = tally(cands, { ...OFF, tFav: T_MIN }, 2000);
		expect(counts[2] / 2000).toBeGreaterThanOrEqual(0.99);
	});

	it('a moderate temperature prefers, but does not insist on, the factor', () => {
		const stale = candidate();
		const fresh = candidate({ lastPracticed: NOW });
		const [a, b] = weights([stale, fresh], { ...OFF, tAge: 1 }, NOW).map((w) => w.p);
		// logit difference 1: e / (1 + e).
		expect(a).toBeCloseTo(Math.E / (1 + Math.E), 10);
		expect(b).toBeCloseTo(1 / (1 + Math.E), 10);
		const firsts = tally([stale, fresh], { ...OFF, tAge: 1 }, 10000);
		expect(firsts[0] / 10000).toBeCloseTo(a, 1);
	});

	it('stays finite and total with extreme temperatures', () => {
		const cands = [candidate(), candidate({ skill: 5, lastPracticed: NOW }), candidate()];
		const extreme = { tAge: 1e-300, tSkill: 1e-300, tFav: 1e-300 };
		const w = weights(cands, extreme, NOW);
		for (const row of w) expect(Number.isFinite(row.p)).toBe(true);
		expect(w.reduce((s, r) => s + r.p, 0)).toBeCloseTo(1, 12);
		expect(w[0].p).toBeCloseTo(0.5, 12);
		expect(w[1].p).toBe(0);
		// Even 0 doesn't divide by zero into NaN.
		const zero = weights(cands, { tAge: 0, tSkill: 0, tFav: null }, NOW);
		expect(zero.map((r) => r.p)).toEqual([0.5, 0, 0.5]);

		for (const temps of [extreme, { tAge: 0, tSkill: 0, tFav: null }, { ...OFF, tAge: 1e-200 }]) {
			const firsts = tally(cands, temps, 1000);
			// The fresh, strong piece is last every time; the two infinite ones share first place.
			expect(firsts[1]).toBe(0);
			expect(Math.abs(firsts[0] - 500)).toBeLessThan(100);
			for (const seed of SEEDS(50)) {
				const order = shuffleOrder(cands, temps, seed, NOW);
				for (const r of order) {
					expect(Number.isNaN(r.logit)).toBe(false);
					expect(Number.isFinite(r.gumbel)).toBe(true);
				}
				expect(order[2].candidate).toBe(cands[1]);
				// Deterministic whatever order the candidates come in.
				const reversed = shuffleOrder([...cands].reverse(), temps, seed, NOW);
				expect(reversed.map((r) => r.candidate)).toEqual(order.map((r) => r.candidate));
			}
		}
	});

	it('orders nothing, and one candidate on its own', () => {
		expect(shuffleOrder([], OFF, 'x', NOW)).toEqual([]);
		const only = candidate();
		expect(
			shuffleOrder([only], { tAge: 0.05, tSkill: 1, tFav: 2 }, 'x', NOW).map((r) => r.candidate)
		).toEqual([only]);
	});

	it('hashes (seed, piece) to a uniform strictly inside (0, 1)', () => {
		expect(hash53('abc')).toBe(hash53('abc'));
		expect(hash53('abc')).not.toBe(hash53('abd'));
		expect(Number.isSafeInteger(hash53('abc'))).toBe(true);
		let sum = 0;
		const n = 20000;
		const buckets = new Array(10).fill(0);
		for (let k = 0; k < n; k++) {
			const u = pieceUniform('seed', `piece-${k}`);
			expect(u).toBeGreaterThan(0);
			expect(u).toBeLessThan(1);
			sum += u;
			buckets[Math.floor(u * 10)]++;
		}
		expect(sum / n).toBeCloseTo(0.5, 2);
		// 9 degrees of freedom: 27.88 is the 0.1% critical value.
		expect(
			chiSquare(
				buckets,
				buckets.map(() => n / 10)
			)
		).toBeLessThan(27.88);
		expect(pieceUniform('a', 'x')).toBe(pieceUniform('a', 'x'));
		expect(pieceUniform('a', 'x')).not.toBe(pieceUniform('b', 'x'));
		// The extremes of the mapping stay finite through the Gumbel transform.
		expect(Number.isFinite(gumbel(0.5 / 2 ** 52))).toBe(true);
		expect(Number.isFinite(gumbel(1 - 2 ** -53))).toBe(true);
	});
});

describe('sessions', () => {
	function library() {
		const lib = emptyLibrary();
		const ids: PieceId[] = [];
		for (let k = 0; k < 12; k++) {
			ids.push(
				add(lib, `Tune ${k}`, {
					skill: ((k % 5) + 1) as 1 | 2 | 3 | 4 | 5,
					favorite: k % 3 === 0,
					practiced: k % 4 === 0 ? [] : [NOW - k * 7 * DAY]
				})
			);
		}
		return { lib, ids };
	}

	const order = (lib: Library, seed: string, at = NOW) =>
		sessionOrder(buildIndex(lib), settings(), { seed, at });

	it('the same seed, time and library give the same order', () => {
		const { lib, ids } = library();
		const a = order(lib, 'abc123');
		expect(a).toEqual(order(structuredClone(lib), 'abc123'));
		expect([...a].sort()).toEqual([...ids].sort());
		expect(order(lib, 'other')).not.toEqual(a);
	});

	it('adding or removing a piece leaves the others in the same relative order', () => {
		const { lib, ids } = library();
		const before = order(lib, 'seed1');
		const added = add(lib, 'Newcomer', { skill: 2 });
		const after = order(lib, 'seed1');
		expect(after.filter((id) => id !== added)).toEqual(before);
		lib.pieces[ids[3]].deletedAt = NOW;
		expect(order(lib, 'seed1')).toEqual(after.filter((id) => id !== ids[3]));
	});

	it('practice logged after the session started does not change the order', () => {
		const { lib } = library();
		const at = NOW;
		const s = settings({ tAge: 0.05, tSkill: null, tFav: null });
		const before = sessionOrder(buildIndex(lib), s, { seed: 'p', at });
		// Practise the first three, as you would during the session.
		for (const id of before.slice(0, 3)) logPractice(lib, id, { now: at + 60_000 });
		expect(sessionOrder(buildIndex(lib), s, { seed: 'p', at })).toEqual(before);
		// A new session does see it.
		const later = sessionOrder(buildIndex(lib), s, { seed: 'p', at: at + 120_000 });
		expect(later).not.toEqual(before);
	});

	it('the list’s "practiced within" filter also looks at practice up to the start', () => {
		const { lib, ids } = library();
		const list = {
			...lib.settings.list,
			practiced: { within: false, days: 1 }
		};
		const s = settings({ respectListFilter: true });
		const before = sessionOrder(buildIndex(lib), s, { seed: 'f', at: NOW, list });
		expect(before).toContain(ids[0]);
		logPractice(lib, ids[0], { now: NOW + 1000 });
		expect(sessionOrder(buildIndex(lib), s, { seed: 'f', at: NOW, list })).toEqual(before);
	});

	it('parses and writes the URL form', () => {
		const s = { seed: 'k3j9x2a1', at: 1761200000000, i: 4 };
		expect(sessionQuery(s)).toBe('seed=k3j9x2a1&at=1761200000000&i=4');
		expect(parseSession(new URLSearchParams(sessionQuery(s)))).toEqual(s);
		expect(parseSession(new URLSearchParams('seed=abc&at=5'))).toEqual({
			seed: 'abc',
			at: 5,
			i: 0
		});
		expect(parseSession(new URLSearchParams('seed=abc&at=5&i=-2'))).toEqual({
			seed: 'abc',
			at: 5,
			i: 0
		});
		expect(parseSession(new URLSearchParams(''))).toBeUndefined();
		expect(parseSession(new URLSearchParams('seed=abc'))).toBeUndefined();
		expect(parseSession(new URLSearchParams('seed=a%20b&at=5'))).toBeUndefined();
		expect(parseSession(new URLSearchParams('seed=abc&at=soon'))).toBeUndefined();
		const seed = newSeed();
		expect(seed).toMatch(/^[0-9a-z]{8}$/);
		expect(parseSession(new URLSearchParams(`seed=${seed}&at=1`))?.seed).toBe(seed);
	});

	it('fingerprints the settings an order depends on', () => {
		const lib = emptyLibrary();
		const base = shuffleFingerprint(settings(), lib.settings.list);
		expect(shuffleFingerprint(settings({ tAge: 0.1 }), lib.settings.list)).not.toBe(base);
		expect(shuffleFingerprint(settings({ skillMin: 2 }), lib.settings.list)).not.toBe(base);
		// The list only counts when it's respected, and its sort never does.
		const favorites = { ...lib.settings.list, favoritesOnly: true };
		expect(shuffleFingerprint(settings(), favorites)).toBe(base);
		const respect = settings({ respectListFilter: true });
		expect(shuffleFingerprint(respect, favorites)).not.toBe(
			shuffleFingerprint(respect, lib.settings.list)
		);
		expect(shuffleFingerprint(respect, { ...lib.settings.list, sort: 'skill' })).toBe(
			shuffleFingerprint(respect, lib.settings.list)
		);
	});
});

describe('candidates', () => {
	function library() {
		const lib = emptyLibrary();
		const ids = {
			kesh: add(lib, 'The Kesh', { skill: 3 }),
			cooleys: add(lib, 'Cooley’s', { skill: 5, favorite: true }),
			unrated: add(lib, 'Unrated reel'),
			set: add(lib, 'Kesh set', { kind: 'set' as PieceKind }),
			part: add(lib, 'Kesh B part', { kind: 'part' as PieceKind }),
			gone: add(lib, 'Deleted jig', { skill: 2 })
		};
		lib.pieces[ids.gone].deletedAt = 1;
		return { lib, ids };
	}

	const titles = (cs: Candidate[]) => cs.map((c) => c.piece.title).sort();

	it('takes live pieces of the enabled kinds (Tunes by default)', () => {
		const { lib } = library();
		const index = buildIndex(lib);
		expect(titles(shuffleCandidates(index, settings(), { at: NOW }))).toEqual([
			'Cooley’s',
			'The Kesh',
			'Unrated reel'
		]);
		const kinds = { tune: false, set: true, part: true, session: false };
		expect(titles(shuffleCandidates(index, settings({ kinds }), { at: NOW }))).toEqual([
			'Kesh B part',
			'Kesh set'
		]);
		const none = { tune: false, set: false, part: false, session: false };
		expect(shuffleCandidates(index, settings({ kinds: none }), { at: NOW })).toEqual([]);
	});

	it('applies the skill range, counting unrated as 1', () => {
		const { lib } = library();
		const index = buildIndex(lib);
		const range = (skillMin: 1 | 2 | 3 | 4 | 5, skillMax: 1 | 2 | 3 | 4 | 5) =>
			titles(shuffleCandidates(index, settings({ skillMin, skillMax }), { at: NOW }));
		expect(range(2, 5)).toEqual(['Cooley’s', 'The Kesh']);
		expect(range(1, 1)).toEqual(['Unrated reel']);
		expect(range(3, 4)).toEqual(['The Kesh']);
	});

	it('uses a Part’s inherited skill for the range', () => {
		const { lib, ids } = library();
		linkPieces(lib, ids.kesh, ids.part);
		const parts = { tune: false, set: false, part: true, session: false };
		const index = buildIndex(lib);
		expect(toCandidate(index, lib.pieces[ids.part]).skill).toBe(3);
		const s = settings({ kinds: parts, skillMin: 3, skillMax: 3 });
		expect(titles(shuffleCandidates(index, s, { at: NOW }))).toEqual(['Kesh B part']);
		expect(shuffleCandidates(index, { ...s, skillMin: 1, skillMax: 1 }, { at: NOW })).toHaveLength(
			0
		);
	});

	it('optionally intersects with the main list filter', () => {
		const { lib } = library();
		const index = buildIndex(lib);
		const list = { sort: 'title' as const, descending: false, kinds: lib.settings.list.kinds };
		const favorites = { ...list, favoritesOnly: true };
		expect(shuffleCandidates(index, settings(), { at: NOW, list: favorites })).toHaveLength(3);
		expect(
			titles(
				shuffleCandidates(index, settings({ respectListFilter: true }), {
					at: NOW,
					list: favorites
				})
			)
		).toEqual(['Cooley’s']);
	});

	it('practice on a Set makes its tunes fresh', () => {
		const lib = emptyLibrary();
		const tune = add(lib, 'The Kesh', { practiced: [NOW - 100 * DAY] });
		const other = add(lib, 'Other jig', { practiced: [NOW - 100 * DAY] });
		const set = add(lib, 'Kesh set', { kind: 'set' as PieceKind });
		linkPieces(lib, set, tune);
		logPractice(lib, set, { now: NOW - DAY });
		const index = buildIndex(lib);
		const cands = shuffleCandidates(index, settings(), { at: NOW });
		const kesh = cands.find((c) => c.piece.id === tune)!;
		expect(kesh.lastPracticed).toBe(NOW - DAY);
		expect(kesh.timesPracticed).toBe(2);
		expect(features(kesh, NOW).age).toBeCloseTo(1 / 60);
		// So at a low age temperature the other tune comes up first.
		const counts = tally(cands, { ...OFF, tAge: T_MIN }, 500);
		expect(counts[cands.findIndex((c) => c.piece.id === other)]).toBeGreaterThanOrEqual(495);
	});
});

describe('temperature sliders', () => {
	it('maps the top notch to ∞ and the rest onto a log scale', () => {
		expect(temperatureAt(SLIDER_STEPS)).toBeNull();
		expect(temperatureAt(0)).toBe(T_MIN);
		expect(temperatureAt(SLIDER_STEPS - 1)).toBe(T_MAX);
		for (let s = 1; s < SLIDER_STEPS; s++) {
			expect(temperatureAt(s)!).toBeGreaterThan(temperatureAt(s - 1)!);
		}
		// Even steps in log space.
		const r1 = temperatureAt(2)! / temperatureAt(1)!;
		const r2 = temperatureAt(12)! / temperatureAt(11)!;
		expect(r1).toBeCloseTo(r2, 1);
	});

	it('round-trips positions and snaps stored values to the nearest notch', () => {
		for (let s = 0; s <= SLIDER_STEPS; s++) expect(sliderPosition(temperatureAt(s))).toBe(s);
		expect(sliderPosition(null)).toBe(SLIDER_STEPS);
		expect(sliderPosition(0.001)).toBe(0);
		expect(sliderPosition(1000)).toBe(SLIDER_STEPS - 1);
		// The defaults (0.5, 1, 2) land on some finite notch.
		for (const t of [0.5, 1, 2]) {
			const s = sliderPosition(t);
			expect(s).toBeGreaterThan(0);
			expect(s).toBeLessThan(SLIDER_STEPS);
			expect(Math.abs(Math.log(temperatureAt(s)! / t))).toBeLessThan(0.2);
		}
	});
});

describe('setShuffleSettings', () => {
	it('updates fields, kinds key by key, and keeps the range ordered', () => {
		const lib = emptyLibrary();
		setShuffleSettings(lib, { tAge: null, kinds: { ...lib.settings.shuffle.kinds, part: true } });
		expect(lib.settings.shuffle.tAge).toBeNull();
		expect(lib.settings.shuffle.kinds).toEqual({
			session: false,
			set: false,
			tune: true,
			part: true
		});
		setShuffleSettings(lib, { skillMin: 4 });
		setShuffleSettings(lib, { skillMax: 2 });
		expect([lib.settings.shuffle.skillMin, lib.settings.shuffle.skillMax]).toEqual([2, 2]);
		setShuffleSettings(lib, { skillMax: 5, skillMin: 3 });
		expect([lib.settings.shuffle.skillMin, lib.settings.shuffle.skillMax]).toEqual([3, 5]);
		setShuffleSettings(lib, { respectListFilter: true });
		expect(lib.settings.shuffle.respectListFilter).toBe(true);
		setShuffleSettings(lib, { respectListFilter: false });
		expect('respectListFilter' in lib.settings.shuffle).toBe(false);
	});

	it('works on Automerge docs, and concurrent changes to different fields both survive', () => {
		const base = Automerge.from(emptyLibrary() as never) as unknown as Automerge.Doc<Library>;
		const a = Automerge.change(Automerge.clone(base), (d) =>
			setShuffleSettings(d, { tSkill: null, kinds: { ...d.settings.shuffle.kinds, set: true } })
		);
		const b = Automerge.change(Automerge.clone(base), (d) =>
			setShuffleSettings(d, {
				tFav: 0.1,
				skillMin: 2,
				kinds: { ...d.settings.shuffle.kinds, part: true }
			})
		);
		const merged = Automerge.merge(a, b).settings.shuffle;
		expect(merged.tSkill).toBeNull();
		expect(merged.tFav).toBe(0.1);
		expect(merged.skillMin).toBe(2);
		expect(merged.kinds).toMatchObject({ set: true, part: true, tune: true });
	});
});
