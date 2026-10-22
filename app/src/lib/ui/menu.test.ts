import { describe, expect, it } from 'vitest';
import { MENU_GAP, MENU_MARGIN, placeMenu } from './menu.ts';

const viewport = { width: 390, height: 844 };
const menu = { width: 160, height: 200 };

describe('placeMenu', () => {
	it('opens below a button near the top of the screen', () => {
		const p = placeMenu({ top: 10, bottom: 54, right: 380 }, menu, viewport);
		expect(p.top).toBe(54 + MENU_GAP);
		expect(p.bottom).toBeUndefined();
		expect(p.maxHeight).toBeGreaterThanOrEqual(menu.height);
	});

	it('opens above a button near the bottom of the screen', () => {
		const p = placeMenu({ top: 780, bottom: 824, right: 380 }, menu, viewport);
		expect(p.top).toBeUndefined();
		expect(p.bottom).toBe(844 - 780 + MENU_GAP);
	});

	it('picks the roomier side and scrolls when it fits neither', () => {
		const tall = { width: 160, height: 2000 };
		const low = placeMenu({ top: 600, bottom: 644, right: 380 }, tall, viewport);
		expect(low.bottom).toBeDefined();
		expect(low.maxHeight).toBe(600 - MENU_GAP - MENU_MARGIN);
		const high = placeMenu({ top: 100, bottom: 144, right: 380 }, tall, viewport);
		expect(high.top).toBeDefined();
		expect(high.maxHeight).toBe(844 - 144 - MENU_GAP - MENU_MARGIN);
	});

	it('right-aligns with the button but stays inside the viewport', () => {
		expect(placeMenu({ top: 10, bottom: 54, right: 300 }, menu, viewport).left).toBe(140);
		// A button at the left edge: the menu can't hang off to the left.
		expect(placeMenu({ top: 10, bottom: 54, right: 40 }, menu, viewport).left).toBe(MENU_MARGIN);
		// Wider than the screen: pinned to the margin.
		const wide = placeMenu(
			{ top: 10, bottom: 54, right: 380 },
			{ width: 900, height: 50 },
			viewport
		);
		expect(wide.left).toBe(MENU_MARGIN);
	});
});
