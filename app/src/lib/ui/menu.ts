// Placement for the overflow menus (Menu.svelte): pure, so it's unit-tested.

export interface MenuItem {
	label: string;
	run?: () => void;
	/** Opens in a new tab instead of running anything (a real link, so popup blockers allow it). */
	href?: string;
	danger?: boolean;
}

export interface MenuPlacement {
	top?: number;
	bottom?: number;
	left: number;
	maxHeight: number;
}

/** Gap between the button and the list, and between the list and the viewport's edges. */
export const MENU_GAP = 4;
export const MENU_MARGIN = 8;

/**
 * Where to put a menu of `menu` size for a button at `anchor`, in a `viewport`-sized window:
 * below when it fits (or when below has more room), else above; right-aligned with the button
 * but kept inside the window; never taller than the room on its side.
 */
export function placeMenu(
	anchor: { top: number; bottom: number; right: number },
	menu: { width: number; height: number },
	viewport: { width: number; height: number }
): MenuPlacement {
	const below = viewport.height - anchor.bottom - MENU_GAP - MENU_MARGIN;
	const above = anchor.top - MENU_GAP - MENU_MARGIN;
	const down = menu.height <= below || below >= above;
	const room = Math.max(down ? below : above, 0);
	const width = Math.min(menu.width, viewport.width - 2 * MENU_MARGIN);
	const left = Math.min(
		Math.max(anchor.right - width, MENU_MARGIN),
		viewport.width - MENU_MARGIN - width
	);
	return down
		? { top: anchor.bottom + MENU_GAP, left, maxHeight: room }
		: { bottom: viewport.height - anchor.top + MENU_GAP, left, maxHeight: room };
}
