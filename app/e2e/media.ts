import type { Page } from '@playwright/test';

/** A mono 16-bit PCM WAV of a quiet 440 Hz tone, `seconds` long. */
export function wav(seconds: number, rate = 8000): Buffer {
	const samples = Math.round(seconds * rate);
	const data = Buffer.alloc(samples * 2);
	for (let i = 0; i < samples; i++) {
		data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 4000), i * 2);
	}
	const header = Buffer.alloc(44);
	header.write('RIFF', 0);
	header.writeUInt32LE(36 + data.length, 4);
	header.write('WAVE', 8);
	header.write('fmt ', 12);
	header.writeUInt32LE(16, 16);
	header.writeUInt16LE(1, 20); // PCM
	header.writeUInt16LE(1, 22); // mono
	header.writeUInt32LE(rate, 24);
	header.writeUInt32LE(rate * 2, 28);
	header.writeUInt16LE(2, 32);
	header.writeUInt16LE(16, 34);
	header.write('data', 36);
	header.writeUInt32LE(data.length, 40);
	return Buffer.concat([header, data]);
}

export const YT_ID = 'dQw4w9WgXcQ';
export const YT_URL = `https://www.youtube.com/watch?v=${YT_ID}`;
export const SPOTIFY_URL = 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC';

/**
 * A stand-in for the YouTube IFrame API: a "player" whose clock runs at the requested rate, with
 * an iframe placeholder. Rates, loads and seeks are recorded on `window.__yt`.
 */
const YOUTUBE_STUB = `
window.__yt = { rates: [], loaded: [], seeks: [] };
class Player {
	constructor(el, opts) {
		this.opts = opts;
		this.t = (opts.playerVars && opts.playerVars.start) || 0;
		this.rate = 1;
		this.state = -1;
		this.last = performance.now();
		window.__yt.loaded.push(opts.videoId);
		const iframe = document.createElement('iframe');
		iframe.title = 'YouTube video player (stub)';
		el.replaceWith(iframe);
		this.iframe = iframe;
		setTimeout(() => opts.events && opts.events.onReady && opts.events.onReady({ target: this }), 20);
	}
	_set(s) {
		this.state = s;
		const e = this.opts.events;
		if (e && e.onStateChange) e.onStateChange({ data: s, target: this });
	}
	_advance() {
		const now = performance.now();
		if (this.state === 1) this.t = Math.min(this.getDuration(), this.t + ((now - this.last) / 1000) * this.rate);
		this.last = now;
	}
	playVideo() {
		this._advance();
		clearInterval(this.timer);
		this.timer = setInterval(() => {
			this._advance();
			if (this.t >= this.getDuration()) { clearInterval(this.timer); this._set(0); }
		}, 50);
		this._set(1);
	}
	pauseVideo() { this._advance(); clearInterval(this.timer); if (this.state === 1) this._set(2); }
	seekTo(t) { this._advance(); this.t = t; window.__yt.seeks.push(t); }
	getCurrentTime() { this._advance(); return this.t; }
	getDuration() { return 240; }
	getPlayerState() { return this.state; }
	setPlaybackRate(r) { this._advance(); this.rate = r; window.__yt.rates.push(r); }
	getPlaybackRate() { return this.rate; }
	getAvailablePlaybackRates() { return [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]; }
	cueVideoById(o) { clearInterval(this.timer); window.__yt.loaded.push(o.videoId); this.t = o.startSeconds || 0; this._set(5); }
	destroy() { clearInterval(this.timer); this.iframe.remove(); }
}
window.YT = { Player, PlayerState: { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } };
if (window.onYouTubeIframeAPIReady) window.onYouTubeIframeAPIReady();
`;

// A 1×1 transparent PNG, for thumbnails.
const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
	'base64'
);

/**
 * Serves the YouTube IFrame API stub, YouTube/Spotify oEmbed and thumbnails, so no test reaches
 * the real sites. Returns the oEmbed request URLs.
 */
export async function mockMedia(page: Page) {
	const oembeds: string[] = [];
	// On the context, so requests from a page controlled by the service worker are caught too.
	const context = page.context();
	const json = (body: unknown) => ({
		status: 200,
		contentType: 'application/json',
		headers: { 'access-control-allow-origin': '*' },
		body: JSON.stringify(body)
	});
	// Nothing else from YouTube, ever. Registered first: later routes take precedence.
	await context.route(/^https:\/\/([\w-]+\.)?(youtube\.com|googlevideo\.com)\//, (route) =>
		route.abort()
	);
	await context.route('https://www.youtube.com/iframe_api', (route) =>
		route.fulfill({ status: 200, contentType: 'text/javascript', body: YOUTUBE_STUB })
	);
	await context.route(/^https:\/\/www\.youtube\.com\/oembed\?/, (route) => {
		oembeds.push(route.request().url());
		return route.fulfill(
			json({
				title: 'The Kesh — live session',
				author_name: 'Some Fiddler',
				thumbnail_url: 'https://i.ytimg.com/vi/x/hqdefault.jpg'
			})
		);
	});
	await context.route('https://noembed.com/**', (route) =>
		route.fulfill(json({ error: 'unused' }))
	);
	await context.route(/^https:\/\/open\.spotify\.com\/oembed\?/, (route) => {
		oembeds.push(route.request().url());
		return route.fulfill(
			json({ title: 'Kesh Jig (album version)', thumbnail_url: 'https://i.scdn.co/image/x' })
		);
	});
	await context.route(/^https:\/\/(i\.ytimg\.com|i\.scdn\.co)\//, (route) =>
		route.fulfill({ status: 200, contentType: 'image/png', body: PNG })
	);
	return oembeds;
}
