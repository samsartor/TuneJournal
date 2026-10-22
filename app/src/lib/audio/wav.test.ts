import { describe, expect, it } from 'vitest';
import { encodeWav } from './wav';

const view = (buffer: ArrayBuffer) => new DataView(buffer);
const ascii = (buffer: ArrayBuffer, offset: number, length: number) =>
	String.fromCharCode(...new Uint8Array(buffer, offset, length));

describe('encodeWav', () => {
	it('writes a 16-bit PCM WAV header and samples', () => {
		const wav = encodeWav([new Float32Array([0, 0.5, -0.5, 1, -1])], 8000);
		const v = view(wav);
		expect(ascii(wav, 0, 4)).toBe('RIFF');
		expect(v.getUint32(4, true)).toBe(36 + 10);
		expect(ascii(wav, 8, 8)).toBe('WAVEfmt ');
		expect(v.getUint16(20, true)).toBe(1); // PCM
		expect(v.getUint16(22, true)).toBe(1); // mono
		expect(v.getUint32(24, true)).toBe(8000);
		expect(v.getUint32(28, true)).toBe(16000); // bytes a second
		expect(v.getUint16(32, true)).toBe(2);
		expect(v.getUint16(34, true)).toBe(16);
		expect(ascii(wav, 36, 4)).toBe('data');
		expect(v.getUint32(40, true)).toBe(10);
		expect(wav.byteLength).toBe(54);
		const samples = [0, 1, 2, 3, 4].map((i) => v.getInt16(44 + i * 2, true));
		expect(samples).toEqual([0, 16384, -16384, 32767, -32768]);
	});

	it('interleaves channels, or mixes them to mono', () => {
		const left = new Float32Array([0.5, 0.5]);
		const right = new Float32Array([-0.5, 0]);
		const stereo = view(encodeWav([left, right], 100));
		expect(stereo.getUint16(22, true)).toBe(2);
		expect(stereo.getUint16(32, true)).toBe(4);
		expect([0, 1, 2, 3].map((i) => stereo.getInt16(44 + i * 2, true))).toEqual([
			16384, -16384, 16384, 0
		]);
		const mono = view(encodeWav([left, right], 100, { mono: true }));
		expect(mono.getUint16(22, true)).toBe(1);
		expect([0, 1].map((i) => mono.getInt16(44 + i * 2, true))).toEqual([0, 8192]);
	});

	it('normalizes to a peak, and clamps', () => {
		const quiet = view(encodeWav([new Float32Array([0.1, -0.2])], 100, { normalize: 0.5 }));
		expect(quiet.getInt16(46, true)).toBe(-16384);
		expect(quiet.getInt16(44, true)).toBe(Math.round(0.25 * 0x7fff));
		const loud = view(encodeWav([new Float32Array([2, -3])], 100));
		expect([loud.getInt16(44, true), loud.getInt16(46, true)]).toEqual([32767, -32768]);
		// Silence stays silence rather than dividing by zero.
		const silent = view(encodeWav([new Float32Array(3)], 100, { normalize: 0.9 }));
		expect(silent.getInt16(44, true)).toBe(0);
	});

	it('refuses nothing to encode', () => {
		expect(() => encodeWav([], 100)).toThrow();
	});
});
