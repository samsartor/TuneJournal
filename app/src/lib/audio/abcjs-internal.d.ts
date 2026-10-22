// abcjs' decoded-sample cache, which it doesn't export publicly. audio/synth.ts clears it after a
// failed render, since abcjs keeps failed sample loads as rejected promises forever.
declare module 'abcjs/src/synth/sounds-cache.js' {
	const cache: Record<string, Record<string, unknown>>;
	export default cache;
}
