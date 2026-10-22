// A minimal WAV (RIFF, 16-bit PCM) encoder for synthesized renderings (PLAN.md §6.6). Pure, so
// it runs in tests; the renderer hands it an AudioBuffer's channels.

export interface EncodeOptions {
	/** Scale so the loudest sample sits at this peak (0–1). Leave out to keep the level as is. */
	normalize?: number;
	/** Mix down to one channel (smaller, and synthesized tunes are centred anyway). */
	mono?: boolean;
}

/** Interleaved samples, clamped to [-1, 1], as 16-bit little-endian PCM with a WAV header. */
export function encodeWav(
	channels: readonly Float32Array[],
	sampleRate: number,
	options: EncodeOptions = {}
): ArrayBuffer {
	if (channels.length === 0) throw new Error('No audio to encode');
	const length = channels[0].length;
	let sources = channels;
	if (options.mono && channels.length > 1) {
		const mixed = new Float32Array(length);
		for (const ch of channels) for (let i = 0; i < length; i++) mixed[i] += ch[i] / channels.length;
		sources = [mixed];
	}

	let gain = 1;
	if (options.normalize !== undefined) {
		let peak = 0;
		for (const ch of sources) {
			for (let i = 0; i < length; i++) {
				const v = Math.abs(ch[i]);
				if (v > peak) peak = v;
			}
		}
		if (peak > 0) gain = options.normalize / peak;
	}

	const numChannels = sources.length;
	const blockAlign = numChannels * 2;
	const dataBytes = length * blockAlign;
	const buffer = new ArrayBuffer(44 + dataBytes);
	const view = new DataView(buffer);
	const ascii = (offset: number, text: string) => {
		for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
	};
	ascii(0, 'RIFF');
	view.setUint32(4, 36 + dataBytes, true);
	ascii(8, 'WAVE');
	ascii(12, 'fmt ');
	view.setUint32(16, 16, true); // fmt chunk size
	view.setUint16(20, 1, true); // PCM
	view.setUint16(22, numChannels, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * blockAlign, true);
	view.setUint16(32, blockAlign, true);
	view.setUint16(34, 16, true); // bits per sample
	ascii(36, 'data');
	view.setUint32(40, dataBytes, true);

	let offset = 44;
	for (let i = 0; i < length; i++) {
		for (let c = 0; c < numChannels; c++) {
			const v = Math.max(-1, Math.min(1, sources[c][i] * gain));
			view.setInt16(offset, v < 0 ? Math.round(v * 0x8000) : Math.round(v * 0x7fff), true);
			offset += 2;
		}
	}
	return buffer;
}
