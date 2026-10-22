// Surfaces a waiting service worker so the user can choose when to reload (PLAN.md §9).
// Without that, the new version activates on the next cold start.

class PwaUpdate {
	updateAvailable = $state(false);

	#registration?: ServiceWorkerRegistration;
	#started = false;

	async start() {
		if (this.#started || !('serviceWorker' in navigator)) return;
		this.#started = true;

		const registration = await navigator.serviceWorker.ready;
		this.#registration = registration;

		const check = () => {
			// `controller` is null on first install, which isn't an update.
			if (registration.waiting && navigator.serviceWorker.controller) {
				this.updateAvailable = true;
			}
		};
		check();
		registration.addEventListener('updatefound', () => {
			registration.installing?.addEventListener('statechange', check);
		});

		document.addEventListener('visibilitychange', () => {
			if (document.visibilityState === 'visible') registration.update().catch(() => {});
		});
	}

	applyUpdate() {
		const waiting = this.#registration?.waiting;
		if (!waiting) return location.reload();
		navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), {
			once: true
		});
		waiting.postMessage('SKIP_WAITING');
	}
}

export const pwaUpdate = new PwaUpdate();
