<script lang="ts" module>
	interface Detector {
		detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
	}
	interface DetectorClass {
		new (options: { formats: string[] }): Detector;
		getSupportedFormats(): Promise<string[]>;
	}
	const Detector = (globalThis as { BarcodeDetector?: DetectorClass }).BarcodeDetector;

	/** Whether this browser can scan QR codes with the camera (BarcodeDetector + getUserMedia). */
	export async function canScanQr(): Promise<boolean> {
		if (!Detector || !navigator.mediaDevices?.getUserMedia) return false;
		try {
			return (await Detector.getSupportedFormats()).includes('qr_code');
		} catch {
			return false;
		}
	}
</script>

<script lang="ts">
	import { onDestroy } from 'svelte';

	let { onscan, oncancel }: { onscan: (text: string) => void; oncancel: () => void } = $props();

	let video: HTMLVideoElement;
	let error = $state<string>();
	let stream: MediaStream | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let stopped = false;

	async function start() {
		if (!Detector) return;
		try {
			stream = await navigator.mediaDevices.getUserMedia({
				video: { facingMode: 'environment' },
				audio: false
			});
			if (stopped) return stop();
			video.srcObject = stream;
			await video.play();
		} catch (e) {
			console.warn('Camera unavailable', e);
			error = 'Couldn’t open the camera. Paste the link instead.';
			return;
		}
		const detector = new Detector({ formats: ['qr_code'] });
		const tick = async () => {
			if (stopped) return;
			try {
				const [code] = await detector.detect(video);
				if (code?.rawValue) {
					stop();
					onscan(code.rawValue);
					return;
				}
			} catch {
				// The video may not have a frame yet; try again.
			}
			timer = setTimeout(tick, 250);
		};
		tick();
	}

	function stop() {
		stopped = true;
		clearTimeout(timer);
		for (const track of stream?.getTracks() ?? []) track.stop();
		stream = undefined;
	}

	$effect(() => {
		start();
	});

	onDestroy(stop);
</script>

<div class="scanner">
	<video bind:this={video} playsinline muted aria-label="Camera preview"></video>
	{#if error}
		<p class="error" role="alert">{error}</p>
	{:else}
		<p class="muted small">Point the camera at the QR code on your other device.</p>
	{/if}
	<button
		type="button"
		class="btn-quiet"
		onclick={() => {
			stop();
			oncancel();
		}}>Stop scanning</button
	>
</div>

<style>
	.scanner {
		display: grid;
		gap: var(--space-2);
		justify-items: start;
	}

	video {
		width: 100%;
		max-width: 20rem;
		aspect-ratio: 1;
		object-fit: cover;
		border-radius: var(--radius);
		background: var(--color-surface);
	}

	p {
		margin: 0;
	}

	.small {
		font-size: 0.875rem;
	}

	.error {
		color: var(--color-danger);
	}
</style>
