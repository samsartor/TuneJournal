// M6: shuffle candidates, features and sampling (PLAN.md §6.5, §12).

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
	pickNext,
	seededRng,
	shuffleCandidates,
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

function candidate(patch: Partial<Candidate> = {}): Candidate {
	return {
		piece: { id: String(Math.random()) } as never,
		timesPracticed: 0,
		favorite: false,
		...patch
	};
}

/** How often each candidate is picked over `n` draws. */
function tally(cands: Candidate[], s: Parameters<typeof pickNext>[1], n: number, seed = 1) {
	const rng = seededRng(seed);
	const counts = new Map<Candidate, number>(cands.map((c) => [c, 0]));
	for (let i = 0; i < n; i++) {
		const c = pickNext(cands, s, rng, NOW)!;
		counts.set(c, counts.get(c)! + 1);
	}
	return cands.map((c) => counts.get(c)!);
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

describe('sampling', () => {
	it('at a tiny age temperature picks the stalest piece at least 99% of the time', () => {
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
	});

	it('is uniform with every temperature at ∞', () => {
		const cands = [
			candidate({ lastPracticed: NOW, skill: 5, favorite: true, timesPracticed: 50 }),
			candidate({ skill: 1 }),
			candidate({ lastPracticed: NOW - 10 * DAY, skill: 3 }),
			candidate({ favorite: true }),
			candidate({ lastPracticed: NOW - 90 * DAY, timesPracticed: 4 })
		];
		for (const w of weights(cands, OFF, NOW)) expect(w.p).toBeCloseTo(0.2, 12);

		const n = 20000;
		const counts = tally(cands, OFF, n, 42);
		// Chi-square with 4 degrees of freedom: 18.47 is the 0.1% critical value.
		const expected = n / cands.length;
		const chi2 = counts.reduce((sum, c) => sum + (c - expected) ** 2 / expected, 0);
		expect(chi2).toBeLessThan(18.47);
	});

	it('at a tiny skill temperature picks the weakest piece; unrated counts as weakest', () => {
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
	});

	it('at a tiny favorite temperature picks the most-loved piece', () => {
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
	});

	it('stays finite with extreme logits', () => {
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
		expect(pickNext(cands, extreme, seededRng(3), NOW)).not.toBe(cands[1]);
	});

	it('returns nothing from no candidates, and the only one from one', () => {
		expect(pickNext([], OFF, Math.random, NOW)).toBeUndefined();
		const only = candidate();
		expect(pickNext([only], { tAge: 0.05, tSkill: 1, tFav: 2 }, () => 0.999999, NOW)).toBe(only);
	});

	it('the seeded RNG is reproducible and in [0, 1)', () => {
		const a = seededRng(7);
		const b = seededRng(7);
		for (let i = 0; i < 1000; i++) {
			const x = a();
			expect(x).toBe(b());
			expect(x).toBeGreaterThanOrEqual(0);
			expect(x).toBeLessThan(1);
		}
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
		expect(titles(shuffleCandidates(index, settings(), { now: NOW }))).toEqual([
			'Cooley’s',
			'The Kesh',
			'Unrated reel'
		]);
		const kinds = { tune: false, set: true, part: true, session: false };
		expect(titles(shuffleCandidates(index, settings({ kinds }), { now: NOW }))).toEqual([
			'Kesh B part',
			'Kesh set'
		]);
		const none = { tune: false, set: false, part: false, session: false };
		expect(shuffleCandidates(index, settings({ kinds: none }), { now: NOW })).toEqual([]);
	});

	it('leaves out pieces already shown', () => {
		const { lib, ids } = library();
		const shown = new Set([ids.kesh, ids.unrated]);
		expect(titles(shuffleCandidates(buildIndex(lib), settings(), { now: NOW, shown }))).toEqual([
			'Cooley’s'
		]);
	});

	it('applies the skill range, counting unrated as 1', () => {
		const { lib } = library();
		const index = buildIndex(lib);
		const range = (skillMin: 1 | 2 | 3 | 4 | 5, skillMax: 1 | 2 | 3 | 4 | 5) =>
			titles(shuffleCandidates(index, settings({ skillMin, skillMax }), { now: NOW }));
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
		expect(titles(shuffleCandidates(index, s, { now: NOW }))).toEqual(['Kesh B part']);
		expect(shuffleCandidates(index, { ...s, skillMin: 1, skillMax: 1 }, { now: NOW })).toHaveLength(
			0
		);
	});

	it('optionally intersects with the main list filter', () => {
		const { lib } = library();
		const index = buildIndex(lib);
		const list = { sort: 'title' as const, descending: false, kinds: lib.settings.list.kinds };
		const favorites = { ...list, favoritesOnly: true };
		expect(shuffleCandidates(index, settings(), { now: NOW, list: favorites })).toHaveLength(3);
		expect(
			titles(
				shuffleCandidates(index, settings({ respectListFilter: true }), {
					now: NOW,
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
		const cands = shuffleCandidates(index, settings(), { now: NOW });
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
