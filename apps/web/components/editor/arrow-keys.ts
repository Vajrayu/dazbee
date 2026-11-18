'use client'

// The arrow keys along a row of buttons: the small menu's toolbar, the switcher and the Fit tiles,
// in the reading direction, with Tab reaching a toolbar once.
import { type FocusEvent, type KeyboardEvent, useEffect, useState } from 'react'

/** A toolbar's buttons that can be used and show, in order. */
const itemsOf = (bar: HTMLElement) =>
  [...bar.querySelectorAll<HTMLElement>('[data-bar-item]:not(:disabled)')].filter((item) =>
    item.checkVisibility({ visibilityProperty: true }),
  )

/** Moves focus along a toolbar's buttons with the arrow keys, Home and End. */
export function arrowAlong(event: KeyboardEvent<HTMLElement>) {
  moveAlong(event, itemsOf(event.currentTarget))
}

/**
 * Moves focus along `items` with the arrow keys, Home and End, in the reading direction of the
 * element that listens: a toolbar's buttons, the switcher's tabs, or a row of tiles.
 */
export function moveAlong(event: KeyboardEvent<HTMLElement>, items: HTMLElement[]) {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return
  const at = items.indexOf(document.activeElement as HTMLElement)
  if (at < 0) return
  event.preventDefault()
  const forward = (event.key === 'ArrowRight') !== (getComputedStyle(event.currentTarget).direction === 'rtl')
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? items.length - 1
        : (at + (forward ? 1 : -1) + items.length) % items.length
  items[next]?.focus()
}

/**
 * Lets Tab reach a toolbar once, at the button last focused, as a toolbar should; the arrows move
 * along it. Returns the focus handler to put on the toolbar.
 */
export function useRovingTab(bar: HTMLElement | null) {
  const [current, setCurrent] = useState(0)
  useEffect(() => {
    if (!bar) return
    const items = itemsOf(bar)
    const at = Math.min(current, items.length - 1)
    items.forEach((item, i) => {
      item.tabIndex = i === at ? 0 : -1
    })
  })
  return (event: FocusEvent<HTMLElement>) => {
    if (!(event.currentTarget instanceof HTMLElement)) return
    const at = itemsOf(event.currentTarget).indexOf(event.target as HTMLElement)
    if (at >= 0) setCurrent(at)
  }
}
