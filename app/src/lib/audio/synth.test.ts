// Humanization against abcjs' real sequencer output: bar lines, pickups and repeats.
import abcjs, { type TuneObject } from 'abcjs';
import { describe, expect, it } from 'vitest';
import {
	HUMANIZE_OFF,
	type Humanize,
	beatGroups,
	humanizeNotes,
	meterGrid,
	stressAt,
	type Grid,
	type NoteEvent
} from '#lib/domain/humanize.ts';
import { buildTuneAbc } from '#lib/domain/synth.ts';
import { barStarts } from './synth.ts';

const COOLEYS =
	'|:D2|EBBA B2 EB|B2 AB dBAG|FDAD BDAD|FDAD dAFD|! EBBA B2 EB|B2 AB defg|afec dBAF|DEFD E2:|';
const KESH =
	'|:G3 GAB|A3 ABd|edd gdd|edB dBA|G3 GAB|A3 ABd|edd gdB|AGF G3:|!|:BAB dBd|ege dBA|BAB dBG|ABA AGA|BAB dBd|ege dBd|gfg aga|bgf g3:|';
/** A reel bar with grace notes: a cut on a crotchet, a double cut, a cut on a dotted pair. */
const GRACES = '|:{g}A2 FA {ag}f2 {d}e>d|{gef}g4 z4:|';
const JIG_PICKUP = 'A|dBA FAd|ecA GFE|dBA FAd|e2 d d2:|';

function parse(body: string, type: string, times = 2) {
	const tune = buildTuneAbc({ abc: body, key: 'Edorian', type }, times);
	const [parsed] = abcjs.parseOnly(tune.abc) as TuneObject[];
	const sequence = parsed.setUpAudio({ program: 40 });
	const voice = abcjs.synth.sequence(parsed, {})[0] as unknown as Parameters<typeof barStarts>[0];
	const grid = meterGrid(parsed.getMeterFraction()) as Grid;
	const total = sequence.totalDuration;
	const bars = barStarts(voice);
	const notes = sequence.tracks[0].filter((e) => e.cmd === 'note') as NoteEvent[];
	return { sequence, grid, total, bars, notes, times };
}

describe('humanizing abcjs sequences', () => {
	it('finds Cooley’s bars, its pickup inside the repeat and at each time through', () => {
		const { grid, total, bars, notes } = parse(COOLEYS, 'reel');
		expect(total).toBe(32);
		// Pickup, then 8 bars, the shortened last one, the pickup again… 72 bars twice through.
		expect(bars.slice(0, 4)).toEqual([0, 0.25, 1.25, 2.25]);
		const groups = beatGroups(bars, total, grid, 2);
		// Every note on a crotchet beat is strong, every other quaver weak, all the way through.
		for (const note of notes) {
			const start = note.start as number;
			const quaver = Math.round(start * 8);
			if (Math.abs(start * 8 - quaver) > 1e-6) continue;
			expect(stressAt(groups, grid, start)).toBe(quaver % 2 === 0 ? 'strong' : 'weak');
		}
	});

	it('finds a jig’s one-quaver pickup at each time through', () => {
		const { grid, total, bars, notes } = parse(JIG_PICKUP, 'jig');
		const groups = beatGroups(bars, total, grid, 2);
		const once = total / 2;
		// "A|": the 6th quaver of a bar, weak; "d" after it, strong.
		for (const at of [0, once]) {
			expect(stressAt(groups, grid, at)).toBe('weak');
			expect(stressAt(groups, grid, at + 1 / 8)).toBe('strong');
			expect(stressAt(groups, grid, at + 4 / 8)).toBe('strong');
		}
		expect(notes.length).toBeGreaterThan(0);
	});

	it('changes nothing when off, and keeps every note in order with a lilt', () => {
		const tune = parse(KESH, 'jig');
		const input = (settings = HUMANIZE_OFF) => ({
			tracks: tune.sequence.tracks as unknown as NoteEvent[][],
			meter: { num: 6, den: 8 },
			barStarts: tune.bars,
			total: tune.total,
			copies: tune.times,
			settings
		});
		const before = structuredClone(tune.sequence.tracks);
		humanizeNotes(input());
		expect(tune.sequence.tracks).toEqual(before);

		const onsets = humanizeNotes(input({ lilt: 2, accent: 50, attack: 50 }));
		// Two strong quavers a bar (1 and 4): 2 parts of 8 bars, each repeated, twice through.
		expect(onsets).toHaveLength(2 * 64);
		let end = 0;
		for (const note of tune.notes) {
			expect(note.start as number).toBeGreaterThanOrEqual(end - 1e-5);
			end = (note.start as number) + (note.duration as number);
		}
		expect(end).toBeCloseTo(tune.total, 6);
	});

	describe('grace notes', () => {
		/** The first bar's notes once through, with abcjs' own velocities. */
		const graced = () => {
			const tune = parse(GRACES, 'reel', 1);
			const input = (settings: Humanize) => ({
				tracks: tune.sequence.tracks as unknown as NoteEvent[][],
				meter: tune.grid && { num: 4, den: 4 },
				barStarts: tune.bars,
				total: tune.total,
				copies: 1,
				settings
			});
			return { tune, input, melody: () => tune.notes.filter((n) => (n.start as number) < 1) };
		};
		const E = 1 / 8;

		it('abcjs plays graces in their main note’s time, moving it off its written position', () => {
			const { melody } = graced();
			const notes = melody().map((n) => ({ start: n.start, grace: n.style === 'grace' }));
			// {g}A2: the grace on the beat, half of A's crotchet; A itself on the off-beat quaver.
			expect(notes[0]).toEqual({ start: 0, grace: true });
			expect(notes[1]).toEqual({ start: E, grace: false });
			// {ag}f2 on beat 3: two graces in its first quaver, f a quaver late.
			expect(notes.slice(4, 7)).toEqual([
				{ start: 0.5, grace: true },
				{ start: 0.5 + E / 2, grace: true },
				{ start: 0.5 + E, grace: false }
			]);
			// abcjs' velocities: the main note's from its written position (105 on the downbeat), the
			// graces two thirds of that.
			expect(melody()[0].volume).toBe(70);
			expect(melody()[1].volume).toBe(105);
		});

		it('stresses the main note from where its graces start, and leaves the graces alone', () => {
			const { input, melody } = graced();
			const before = melody().map((n) => n.volume);
			const onsets = humanizeNotes(input({ lilt: 1, accent: 40, attack: 20 }));
			const after = melody().map((n) => n.volume);
			// Graces keep their velocity.
			melody().forEach((n, i) => {
				if (n.style === 'grace') expect(after[i]).toBe(before[i]);
			});
			// A (after {g}, written on beat 1) and f (after {ag}, on beat 3): strong, ×1.2.
			expect(after[1]).toBe(Math.round((before[1] as number) * 1.2));
			expect(after[6]).toBe(Math.round((before[6] as number) * 1.2));
			// F and A between them: an off-beat (weak) and a beat (strong) as written.
			expect(after[2]).toBe(Math.round((before[2] as number) * 1.2));
			expect(after[3]).toBe(Math.round((before[3] as number) * 0.8));
			// The attack onsets are the main notes', not the graces': A at a quaver, f at 5/8, and
			// nothing at 0 or 1/2 where the graces start.
			expect(onsets).toContain(E);
			expect(onsets).toContain(0.5 + E);
			expect(onsets).not.toContain(0);
			expect(onsets).not.toContain(0.5);
			// Beat 2 (F) is strong with no graces: its onset is its own.
			expect(onsets).toContain(0.25);
		});

		it('still lilts graces and main notes together, keeping them in order', () => {
			const { input, tune } = graced();
			humanizeNotes(input({ lilt: 1.5, accent: 30, attack: 10 }));
			let end = 0;
			for (const note of tune.notes) {
				expect(note.start as number).toBeGreaterThanOrEqual(end - 1e-5);
				end = (note.start as number) + (note.duration as number);
			}
			// It ends in a rest: the last note, at its written end (bar lines don't move).
			expect(end).toBeCloseTo(tune.total - 0.5, 6);
			// {g}A2 at 1.5:1: the grace takes the long first quaver (1.2 quavers), A the short one.
			const [grace, a] = tune.notes;
			expect(grace.duration).toBeCloseTo(1.2 * E, 5);
			expect(a.start).toBeCloseTo(1.2 * E, 5);
		});
	});
});
