'use client'

// Where the top edge of a phone's open sheet is, so what sits at the bottom of the stage can stand
// above it: a notice, the small menu. Each sheet publishes its own while it shows (`useSheet`), an
// edit panel's and a menu's alike, and the top is the highest of them. While a colour is picked from
// the stage the sheets are hidden, still laid out (`hideSheets`): a notice stands as if none were open.
import { type RefCallback, useLayoutEffect, useState, useSyncExternalStore } from 'react'

/** Each sheet that shows, by its element, and its top edge in the window's pixels. */
const tops = new Map<HTMLElement, number>()
const listeners = new Set<() => void>()
/** The highest top edge of the sheets that show, in the window's pixels; null while none shows. */
let top: number | null = null
/** Whether the sheets are hidden, kept on the page, and the listeners told when that changes. */
let hidden = false
const hiddenListeners = new Set<() => void>()

/** The top edge of the open sheet, in the window's pixels; null while none shows. Read once. */
export const sheetTop = () => top

/** The top edge of the open sheet in `element`'s pixels, from its top edge; null while none shows. Read once. */
export function sheetTopIn(element: Element) {
  return top === null ? null : top - element.getBoundingClientRect().top
}

/** The top edge of the open sheet, in the window's pixels, re-rendering the caller as it changes. */
export function useSheetTop() {
  return useSyncExternalStore(subscribe, sheetTop, () => null)
}

/**
 * Publishes the top edge of a phone's sheet while `on` says it is one: the returned ref goes on the
 * sheet's element. It is measured as the sheet shows, as it grows or shrinks, as the window changes,
 * and once its entrance has ended.
 */
export function useSheet(on: boolean): RefCallback<HTMLElement> {
  const [element, setElement] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => {
    if (!on || !element) return
    const measure = () => publish(element, element.getBoundingClientRect().top)
    measure()
    const watch = new ResizeObserver(measure)
    watch.observe(element)
    window.addEventListener('resize', measure)
    element.addEventListener('animationend', measure)
    return () => {
      watch.disconnect()
      window.removeEventListener('resize', measure)
      element.removeEventListener('animationend', measure)
      publish(element, null)
    }
  }, [on, element])
  return setElement
}

/** Whether the sheets are hidden while a colour is picked from the stage under them. Read once. */
export const sheetsHidden = () => hidden

/** Whether the sheets are hidden while a colour is picked, re-rendering the caller as it changes. */
export function useSheetsHidden() {
  return useSyncExternalStore(subscribeHidden, sheetsHidden, () => false)
}

/** Hides the sheets, or shows them again, telling those that place themselves round them. */
export function hideSheets(on: boolean) {
  if (on === hidden) return
  hidden = on
  for (const listener of hiddenListeners) listener()
}

/** Hears each time the sheets are hidden or shown again, until the function it returns is called. */
function subscribeHidden(listener: () => void) {
  hiddenListeners.add(listener)
  return () => {
    hiddenListeners.delete(listener)
  }
}

/** Hears each change of the top edge, until the function it returns is called. */
function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Sets a sheet's top edge, or takes the sheet away with null, telling the listeners when the highest moves. */
function publish(sheet: HTMLElement, at: number | null) {
  if (at === null) tops.delete(sheet)
  else tops.set(sheet, at)
  const next = tops.size === 0 ? null : Math.min(...tops.values())
  if (next === top) return
  top = next
  for (const listener of listeners) listener()
}
