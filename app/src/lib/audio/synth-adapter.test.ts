import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioTrack } from 'abcjs';
import { renderRequest, buildTuneAbc, DEFAULT_SYNTH_OPTIONS } from '#lib/domain/synth.ts';
import type { PlayerSnapshot } from './adapter';
import { SynthAdapter } from './synth-adapter';
import { fitToSoundfont } from './synth';

/** Seconds of the tune at 100%. */
const TUNE = 80;

/**
 * Just enough of <audio> for HtmlAudioAdapter: a clock we move by hand, and a duration read from
 * the source URL (the stub renderer encodes it in the blob's type).
 */
class FakeAudio extends EventTarget {
	src = '';
	preload = '';
	currentTime = 0;
	duration = NaN;
	paused = true;
	playbackRate = 1;
	defaultPlaybackRate = 1;
	preservesPitch = false;
	error = null;
	load() {
		const d = /d=([\d.]+)/.exec(this.src)?.[1];
		setTimeout(() => {
			this.duration = Number(d);
			this.dispatchEvent(new Event('loadedmetadata'));
		}, 1);
	}
	async play() {
		this.paused = false;
		this.dispatchEvent(new Event('play'));
	}
	pause() {
		this.paused = true;
		this.dispatchEvent(new Event('pause'));
	}
	removeAttribute() {
		this.src = '';
	}
}

describe('SynthAdapter', () => {
	let audio: FakeAudio;
	let rendered: number[];
	let adapter: SynthAdapter;
	let last: PlayerSnapshot | undefined;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => `test:${(blob as Blob).type}`);
		vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
		audio = new FakeAudio();
		rendered = [];
		adapter = new SynthAdapter(
			async (tempo) => {
				rendered.push(tempo);
				return new Blob([], { type: `audio/wav;d=${TUNE / tempo}` });
			},
			audio as unknown as HTMLAudioElement
		);
		adapter.onTime((s) => (last = s));
	});

	afterEach(() => {
		adapter.destroy();
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	async function load(rate: number, start?: number, end?: number) {
		adapter.setRate(rate);
		const loading = adapter.load({ kind: 'synth', url: '', start, end });
		await vi.advanceTimersByTimeAsync(5);
		await loading;
	}

	it('renders at the current speed and reports tune time', async () => {
		await load(0.75);
		expect(rendered).toEqual([0.75]);
		expect(audio.playbackRate).toBe(1);
		expect(last?.duration).toBeCloseTo(TUNE);
		expect(last?.renderedTempo).toBe(0.75);
		adapter.seek(30);
		expect(audio.currentTime).toBeCloseTo(40);
		audio.dispatchEvent(new Event('timeupdate'));
		expect(last?.time).toBeCloseTo(30);
	});

	it('keeps the trim in tune time', async () => {
		await load(0.5, 10, 20);
		expect(audio.currentTime).toBeCloseTo(20);
		adapter.setBounds(12, 16);
		adapter.seek(40);
		expect(audio.currentTime).toBeCloseTo(32);
	});

	it('stretches at once, then swaps in a rendering at the new speed in the same place', async () => {
		await load(1);
		await adapter.play();
		adapter.seek(20);
		adapter.setRate(0.5);
		// Meanwhile the 100% rendering plays at half speed, pitch preserved.
		expect(audio.playbackRate).toBe(0.5);
		expect(adapter.rerendering).toBe(true);
		await vi.advanceTimersByTimeAsync(400);
		expect(rendered).toEqual([1, 0.5]);
		expect(audio.playbackRate).toBe(1);
		expect(audio.currentTime).toBeCloseTo(40);
		expect(audio.paused).toBe(false);
		expect(last?.time).toBeCloseTo(20);
		expect(last?.duration).toBeCloseTo(TUNE);
		expect(last?.renderedTempo).toBe(0.5);
		expect(adapter.rerendering).toBe(false);
	});

	it('waits for the speed to settle, and drops a re-render no longer needed', async () => {
		await load(1);
		adapter.setRate(0.95);
		await vi.advanceTimersByTimeAsync(100);
		adapter.setRate(0.9);
		await vi.advanceTimersByTimeAsync(100);
		adapter.setRate(1);
		await vi.advanceTimersByTimeAsync(1000);
		expect(rendered).toEqual([1]);
		expect(audio.playbackRate).toBe(1);
	});

	it('re-renders in place for new options and for a pitch shift', async () => {
		await load(0.8);
		adapter.seek(10);
		adapter.rerender({ force: true });
		await vi.advanceTimersByTimeAsync(5);
		adapter.setPitchShift(2);
		await vi.advanceTimersByTimeAsync(5);
		expect(rendered).toEqual([0.8, 0.8, 0.8]);
		expect(audio.currentTime).toBeCloseTo(12.5);
	});
});

describe('fitToSoundfont', () => {
	const request = (instrument: 'fiddle' | 'whistle' | 'piano', chords = true) =>
		renderRequest(buildTuneAbc({ abc: 'A' }), { ...DEFAULT_SYNTH_OPTIONS, instrument, chords });
	const note = (pitch: number, instrument: number) =>
		({ cmd: 'note', pitch, instrument, start: 0, duration: 0.125, volume: 90, gap: 0 }) as const;

	it('puts the melody on the chosen instrument and chords on the piano, in range', () => {
		const tracks = [
			[{ cmd: 'program', channel: 0, instrument: 22 }, note(50, 22), note(100, 22), note(69, 22)],
			[{ cmd: 'program', channel: 1, instrument: 0 }, note(30, 0), note(60, 0)]
		] as unknown as AudioTrack[];
		fitToSoundfont(tracks, request('fiddle'));
		const [melody, chords] = tracks.map((t) => t.flatMap((e) => (e.cmd === 'note' ? [e] : [])));
		expect(tracks[0][0]).toMatchObject({ cmd: 'program', instrument: 40 });
		expect(melody.map((n) => [n.instrument, n.pitch])).toEqual([
			[40, 62],
			[40, 88],
			[40, 69]
		]);
		expect(chords.map((n) => [n.instrument, n.pitch])).toEqual([
			[0, 42],
			[0, 60]
		]);
	});

	it('plays whistle an octave up', () => {
		const tracks = [[note(62, 78), note(83, 78)]] as unknown as AudioTrack[];
		fitToSoundfont(tracks, request('whistle'));
		expect(tracks[0].map((n) => (n as { pitch: number }).pitch)).toEqual([74, 95]);
	});
});
