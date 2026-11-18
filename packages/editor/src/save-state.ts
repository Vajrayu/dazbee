// Where the design's edits are: on the sync server, on their way, or only on this device; and what
// the sync server said besides: that this tab may only view the design, or why it will take nothing
// more from this tab. It reads the sync link.
import { SCHEMA_VERSION, TAB_VERSION_PARAM } from '@dazbee/schema'

/**
 * Where the design's edits are, once it is open; ViewOnly while this tab's member may only view the
 * design, so nothing is saved. Once the sync server will take nothing more from this tab, it stops
 * connecting and says why: Outdated when the tab is older than the design, so the page must reload to
 * edit it; Deleted when the design was deleted; Replaced when this tab is open in another window;
 * NoAccess when the API turns the member away (the design gone, or their access).
 */
export type SaveState = 'Saved' | 'Saving' | 'Offline' | 'ViewOnly' | 'Outdated' | 'Deleted' | 'Replaced' | 'NoAccess'

/** The save states a tab stops connecting in. */
export type Stopped = Extract<SaveState, 'Outdated' | 'Deleted' | 'Replaced' | 'NoAccess'>

/** Why a link no longer connects, besides a tab older than the design (status `Outdated`). */
export type LinkEnd = 'designDeleted' | 'replaced' | 'refused'

/** Where a connection to the sync server is: connected, not (yet), or stopped for a reason the save state shows. */
export type LinkStatus = 'connected' | 'disconnected' | Stopped

/** A connection to the sync server as the save state reads it: the sync link. */
export interface Link {
  status(): LinkStatus
  /** Whether the sync server last said this tab's member may only view the design. */
  viewOnly(): boolean
  /** Whether nothing of this tab's waits for the sync server: Saved. */
  synced(): boolean
  /** Told whenever any of the three may have changed; returns what stops it. */
  onStatus(listener: () => void): () => void
  connect(): void
  disconnect(): void
}

export interface SaveStateDeps {
  link: Link
  /** Told each time the shown save state changes. */
  onSaveState: (state: SaveState) => void
}

/** The link's connection and the save state shown for it. */
export interface SaveStateWatch {
  /** Whether the sync server is connected now. */
  connected(): boolean
  /** Shows the save state from now on, and follows the browser's network: called once the editor is open. */
  start(): void
  destroy(): void
}

export const SAVE_STATES: readonly string[] = [
  'Saved',
  'Saving',
  'Offline',
  'ViewOnly',
  'Outdated',
  'Deleted',
  'Replaced',
  'NoAccess',
] satisfies SaveState[]

/** The stopped save state each end of a link shows. */
export const STOPPED_BY_END: Record<LinkEnd, Stopped> = {
  designDeleted: 'Deleted',
  replaced: 'Replaced',
  refused: 'NoAccess',
}

/** How long the connection can be gone before the save state reads Offline. */
const OFFLINE_AFTER_MS = 1500

/** The sync server's URL for this tab, saying which schema version the tab was built with. */
export function syncUrl(url: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}${TAB_VERSION_PARAM}=${SCHEMA_VERSION}`
}

export function watchSaveState({ link, onSaveState: status }: SaveStateDeps): SaveStateWatch {
  /** The save state shown, null until `start`. */
  let shown: SaveState | null = null
  /** Turns a lost connection into Offline once it has been gone a moment. */
  let offlineTimer = 0
  // Removes the browser's network listeners, on destroy.
  const listening = new AbortController()
  const on = { signal: listening.signal }

  const connected = () => link.status() === 'connected'

  const show = (next: SaveState) => {
    if (next === shown) return
    shown = next
    status(next)
  }
  /**
   * Shows where the edits are: on the sync server, on their way, or only on this device. A lost
   * connection reads Offline after a moment, so a reconnect that takes a blink doesn't flash it. A
   * tab the server stopped says why at once, even while it opens.
   */
  const saveState = () => {
    const connection = link.status()
    let next: SaveState
    if (connection !== 'connected' && connection !== 'disconnected') {
      clearTimeout(offlineTimer)
      offlineTimer = 0
      next = connection
    } else if (connection === 'connected') {
      clearTimeout(offlineTimer)
      offlineTimer = 0
      next = link.viewOnly() ? 'ViewOnly' : link.synced() ? 'Saved' : 'Saving'
    } else if (!navigator.onLine) {
      next = 'Offline'
    } else {
      if (!offlineTimer && shown !== 'Offline') {
        offlineTimer = window.setTimeout(() => {
          offlineTimer = 0
          if (link.status() === 'disconnected') show('Offline')
        }, OFFLINE_AFTER_MS)
      }
      next = shown === 'Offline' ? 'Offline' : 'Saving'
    }
    show(next)
  }
  const stopped = () => link.status() !== 'connected' && link.status() !== 'disconnected'
  const onStatus = () => {
    if (shown || stopped()) saveState()
  }

  function start() {
    // The browser knows first when the network goes: drop the socket rather than wait for it to time
    // out, and connect again as soon as the network is back.
    window.addEventListener('offline', () => link.disconnect(), on)
    window.addEventListener(
      'online',
      () => {
        if (!stopped()) link.connect()
      },
      on,
    )
    saveState()
  }

  const unlisten = link.onStatus(onStatus)

  function destroy() {
    unlisten()
    clearTimeout(offlineTimer)
    listening.abort()
  }

  return {
    connected,
    start,
    destroy,
  }
}
