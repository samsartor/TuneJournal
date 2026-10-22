// Downloads the self-hosted soundfont subset for synthesized playback (PLAN.md §6.6, §14) into
// static/soundfont/. Run once with `node scripts/fetch-soundfont.js`; the files are committed.
//
// The samples are gleitz/midi-js-soundfonts' FluidR3_GM set (CC BY 3.0, see the README written
// next to them), in the per-note MP3 layout abcjs loads: <instrument>-mp3/<note>.mp3. Only the
// instruments and pitch ranges in src/lib/domain/synth.ts are fetched; the renderer folds any note
// outside a range into it by octaves, so nothing else is ever requested.

import { mkdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const BASE = 'https://paulrosen.github.io/midi-js-soundfonts/FluidR3_GM/';
const OUT = new URL('../static/soundfont/', import.meta.url).pathname;

// Keep in step with SOUNDFONT_RANGES in src/lib/domain/synth.ts.
const RANGES = {
	violin: [55, 88],
	flute: [60, 93],
	whistle: [72, 98],
	accordion: [53, 88],
	acoustic_grand_piano: [36, 88]
};

const NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const noteName = (midi) => `${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;

async function exists(path) {
	try {
		return (await stat(path)).size > 0;
	} catch {
		return false;
	}
}

let bytes = 0;
let files = 0;
for (const [instrument, [lo, hi]] of Object.entries(RANGES)) {
	const dir = join(OUT, `${instrument}-mp3`);
	await mkdir(dir, { recursive: true });
	for (let midi = lo; midi <= hi; midi++) {
		const file = join(dir, `${noteName(midi)}.mp3`);
		if (!(await exists(file))) {
			const res = await fetch(`${BASE}${instrument}-mp3/${noteName(midi)}.mp3`);
			if (!res.ok) throw new Error(`${res.status} for ${instrument} ${noteName(midi)}`);
			await writeFile(file, new Uint8Array(await res.arrayBuffer()));
		}
		bytes += (await stat(file)).size;
		files++;
	}
}
console.log(`${files} files, ${(bytes / 1024 / 1024).toFixed(2)} MB in ${OUT}`);
