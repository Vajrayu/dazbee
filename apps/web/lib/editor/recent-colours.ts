'use client'

// Recent colours: the colours last picked or typed, per brand (a brand is a wall) and per device,
// kept in the browser's storage and never in the design, its undo, its sync or its exports. The
// device's other tabs hear a change by the `storage` event; two writing at once may overwrite each
// other, the last winning, which a convenience list accepts. Where storage throws (blocked, or
// full) the list is kept in memory for the tab.
import { useCallback, useSyncExternalStore } from 'react'

import { hexOf, holdsColour, parseHex } from '@/lib/colour.ts'

/** Where the lists are kept, and how another tab's change is heard: the browser's, or a test's. */
export interface RecentPlace {
  /** The device's storage; it may throw, as a blocked one does when read. */
  storage: () => Pick<Storage, 'getItem' | 'setItem'>
  /** Calls back with the key another tab changed (null when it cleared them all); gives what stops it. */
  onStorage: (listener: (key: string | null) => void) => () => void
}

/** How many colours a brand keeps on a device, newest first. */
export const RECENT_KEPT = 16
/** How many a row shows. */
export const RECENT_SHOWN = 8

/** Where a brand's list is kept on the device. */
export const recentKey = (brandId: string) => `dazbee.recentColours.${brandId}`

/** No recent colours, as the server renders the row. */
const NONE: readonly string[] = []

/** Recent colours kept in a place: each brand's list, a colour added to it, and its changes heard. */
export function recentColours(place: RecentPlace) {
  /** Each brand's list as last read or written: the same array until it changes. */
  const lists = new Map<string, readonly string[]>()
  /** Each brand's subscribers, told when its list changes here or in another tab. */
  const listeners = new Map<string, Set<() => void>>()
  /** Whether another tab's changes are heard yet: from the first read on, for as long as the page is open. */
  let hearing = false

  /** A brand's list, newest first: as stored, else as kept in memory. */
  function list(brandId: string): readonly string[] {
    hear()
    const kept = lists.get(brandId)
    if (kept) return kept
    let read: readonly string[] = []
    try {
      read = parse(place.storage().getItem(recentKey(brandId)))
    } catch {
      // Storage that throws keeps nothing: the list starts empty and lives in memory.
    }
    lists.set(brandId, read)
    return read
  }
  /** Puts a colour first in a brand's list, as #RRGGBB, once; junk is left out. */
  function add(brandId: string, colour: string) {
    const hex = recentHex(colour)
    if (!hex) return
    const next = [hex, ...list(brandId).filter((h) => h !== hex)].slice(0, RECENT_KEPT)
    lists.set(brandId, next)
    try {
      place.storage().setItem(recentKey(brandId), JSON.stringify(next))
    } catch {
      // Blocked or full: the tab keeps it in memory.
    }
    tell(brandId)
  }
  /** Calls back when a brand's list changes, here or in another tab; gives what stops it. */
  function subscribe(brandId: string, listener: () => void) {
    hear()
    const own = listeners.get(brandId) ?? new Set()
    listeners.set(brandId, own)
    own.add(listener)
    return () => {
      own.delete(listener)
    }
  }
  /** Hears another tab change a brand's list, or clear them all: read again, and told. */
  function hear() {
    if (hearing) return
    hearing = true
    place.onStorage((key) => {
      for (const brandId of new Set([...lists.keys(), ...listeners.keys()])) {
        if (key !== null && key !== recentKey(brandId)) continue
        lists.delete(brandId)
        tell(brandId)
      }
    })
  }
  function tell(brandId: string) {
    for (const listener of [...(listeners.get(brandId) ?? [])]) listener()
  }

  return { list, add, subscribe }
}

/** The first RECENT_SHOWN of a list that the brand kit's colours don't hold, so leaving those out doesn't shorten the row. */
export function shownRecent(list: readonly string[], kit: readonly string[]): string[] {
  return list.filter((hex) => !holdsColour(kit, hex)).slice(0, RECENT_SHOWN)
}

/** The browser's recent colours: its local storage, and the `storage` event its other tabs raise. */
export const browserRecent = recentColours({
  storage: () => window.localStorage,
  onStorage(listener) {
    const heard = (event: StorageEvent) => {
      if (event.storageArea === null || event.storageArea === window.localStorage) listener(event.key)
    }
    window.addEventListener('storage', heard)
    return () => window.removeEventListener('storage', heard)
  },
})

/** A brand's recent colours on this device, re-rendering the caller as they change. */
export function useRecentColours(brandId: string): readonly string[] {
  const subscribe = useCallback((listener: () => void) => browserRecent.subscribe(brandId, listener), [brandId])
  const get = useCallback(() => browserRecent.list(brandId), [brandId])
  return useSyncExternalStore(subscribe, get, () => NONE)
}

/** A stored list as kept: the colours of a JSON array, newest first, each once, RECENT_KEPT at most. */
function parse(stored: string | null): readonly string[] {
  if (stored === null) return []
  let read: unknown
  try {
    read = JSON.parse(stored)
  } catch {
    return []
  }
  if (!Array.isArray(read)) return []
  const hexes = read.map(recentHex).filter((hex): hex is string => hex !== null)
  return [...new Set(hexes)].slice(0, RECENT_KEPT)
}

/** A colour as #RRGGBB, read as a hex typed is, its alpha left out; null when it is none. */
function recentHex(colour: unknown): string | null {
  const parsed = typeof colour === 'string' ? parseHex(colour) : null
  return parsed && hexOf(parsed)
}
