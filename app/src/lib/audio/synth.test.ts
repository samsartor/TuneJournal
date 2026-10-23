// Humanization against abcjs' real sequencer output: bar lines, pickups and repeats.
import abcjs, { type TuneObject } from 'abcjs';
import { describe, expect, it } from 'vitest';
import {
	HUMANIZE_OFF,
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
			expect(stressAt(groups, grid, 'irish', start)).toBe(quaver % 2 === 0 ? 'strong' : 'weak');
		}
	});

	it('finds a jig’s one-quaver pickup at each time through', () => {
		const { grid, total, bars, notes } = parse(JIG_PICKUP, 'jig');
		const groups = beatGroups(bars, total, grid, 2);
		const once = total / 2;
		// "A|": the 6th quaver of a bar, weak; "d" after it, strong.
		for (const at of [0, once]) {
			expect(stressAt(groups, grid, 'irish', at)).toBe('weak');
			expect(stressAt(groups, grid, 'irish', at + 1 / 8)).toBe('strong');
			expect(stressAt(groups, grid, 'irish', at + 4 / 8)).toBe('strong');
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

		const onsets = humanizeNotes(input({ style: 'irish', lilt: 100, accent: 50, attack: 50 }));
		// Two strong quavers a bar (1 and 4): 2 parts of 8 bars, each repeated, twice through.
		expect(onsets).toHaveLength(2 * 64);
		let end = 0;
		for (const note of tune.notes) {
			expect(note.start as number).toBeGreaterThanOrEqual(end - 1e-5);
			end = (note.start as number) + (note.duration as number);
		}
		expect(end).toBeCloseTo(tune.total, 6);
	});
});
