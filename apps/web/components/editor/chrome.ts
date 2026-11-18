import { MENU_EDGE } from '@/components/ui/menu.tsx'

/**
 * The editor's chrome that a piece floating over the stage, the small menu or a toast, keeps clear
 * of, as selectors: the edit panel, the open flyout, the dock with the flyouts' buttons, the zoom
 * pill, Pages, the phone's tab bar and the two islands.
 */
export const CHROME = [
  '#edit-panel',
  '#editor-flyout',
  '[data-dock]',
  '[data-zoom]',
  '[data-pages]',
  '[data-testid="tab-bar"]',
  '[data-testid="island-start"]',
  '[data-testid="island-end"]',
]

/** The element's box in the window, or null while it doesn't show. */
export function shownBox(el: Element | null): DOMRect | null {
  const box = el?.getBoundingClientRect()
  if (!el || !box || box.width === 0 || box.height === 0 || getComputedStyle(el).visibility === 'hidden') return null
  return box
}

/** How far the open flyout reaches from the window's start edge, MENU_EDGE clear of it, as it shows now; MENU_EDGE with none open. */
export function flyoutReach(rtl: boolean): number {
  const width = document.documentElement.clientWidth
  const box = shownBox(document.querySelector('#editor-flyout'))
  return (box ? Math.round(rtl ? width - box.left : box.right) : 0) + MENU_EDGE
}

/**
 * How far from the window's start edge a menu `width` wide keeps: past the open flyout (`reach`)
 * when `room`, the room it has past it, holds it; else MENU_EDGE, over the flyout.
 */
export function menuStartInset(reach: number, room: number, width: number) {
  return room >= width ? reach : MENU_EDGE
}
