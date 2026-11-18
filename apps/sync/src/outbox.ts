// What goes out on one tab's socket (D7, D10). A preview and a presence are for display only and the
// next one from their sender replaces each, so while the socket is behind (bytes still waiting to
// leave), only each sender's latest of each is kept and goes out once the socket has drained; a
// `left` drops its sender's. A presence also goes out at most `presencePerSecond` times a second
// from each sender: one that comes sooner waits for its turn, replacing any waiting before it, so the
// last is never lost. A socket with more than `unsentBytes` waiting has stopped reading: it is ended
// at once, with no close frame, which it would not read either.
import type { VersionAnswer } from '@dazbee/doc/sync'
import { type ServerMessage, SYNC_LIMITS } from '@dazbee/schema'

import type { Data } from './outgoing.ts'

/** The socket, as the outbox writes to it. */
export interface Wire {
  /** The bytes still waiting to leave. */
  readonly bufferedAmount: number
  /** Sends `data`, calling `written` once it has left. */
  send(data: Data, written: () => void): void
  terminate(): void
}

export interface Outbox {
  send(data: Data, message: ServerMessage | VersionAnswer): void
  /** Sends nothing more and drops what it holds. */
  end(): void
}

export interface OutboxOptions {
  unsentBytes: number
  /** Told that it ended a socket that stopped reading. */
  ended: () => void
  /** The presence each sender may send each second (`SYNC_LIMITS`' unless given). */
  presencePerSecond?: number
  /** The clock, in milliseconds. */
  now?: () => number
}

/** A preview or a presence held: its sender, its data, and when it may go. */
interface Held {
  tabId: number
  data: Data
  due: number
}

/** How often a socket holding previews is checked for having drained, when no write finishes. */
const CHECK_MS = 25

/** The outbox of `wire`. */
export function outbox(
  wire: Wire,
  { unsentBytes, ended, presencePerSecond = SYNC_LIMITS.presencePerSecond, now = Date.now }: OutboxOptions,
): Outbox {
  /** The least time between two presences from one sender. */
  const gap = 1000 / presencePerSecond
  /** The latest preview and presence held from each sender, by type and tab id. */
  const held = new Map<string, Held>()
  /** When each sender's last presence went out. */
  const presenceAt = new Map<number, number>()
  let check: ReturnType<typeof setTimeout> | undefined
  let over = false

  function write(data: Data) {
    if (over) return
    if (wire.bufferedAmount > unsentBytes) {
      end()
      wire.terminate()
      ended()
      return
    }
    wire.send(data, written)
  }

  /** A write left: what is held goes once nothing waits. */
  function written() {
    if (held.size > 0 && wire.bufferedAmount === 0) flush()
  }

  /** Sends what is held and due once the socket has drained, and checks again for the rest. */
  function flush() {
    if (check) clearTimeout(check)
    check = undefined
    if (over || held.size === 0) return
    if (wire.bufferedAmount > 0) {
      check = setTimeout(flush, CHECK_MS)
      return
    }
    const time = now()
    const due = [...held].filter(([, h]) => h.due <= time)
    for (const [key] of due) held.delete(key)
    for (const [key, h] of due) {
      if (key.startsWith('presence')) presenceAt.set(h.tabId, time)
      write(h.data)
    }
    const next = Math.min(...[...held.values()].map((h) => h.due))
    if (held.size > 0) check = setTimeout(flush, Math.max(0, next - time))
  }

  /** Holds a sender's latest preview or presence, after anything held before it, until `due`. */
  function hold(key: string, h: Held) {
    held.delete(key)
    held.set(key, h)
    check ??= setTimeout(flush, Math.max(0, h.due - now()))
  }

  function end() {
    over = true
    held.clear()
    if (check) clearTimeout(check)
    check = undefined
  }

  return {
    send(data, message) {
      if (over) return
      if (message.type === 'preview') {
        const key = `preview ${message.tabId}`
        if (wire.bufferedAmount === 0 && !held.has(key)) return write(data)
        return hold(key, { tabId: message.tabId, data, due: 0 })
      }
      if (message.type === 'presence') {
        const key = `presence ${message.tabId}`
        const due = (presenceAt.get(message.tabId) ?? -Infinity) + gap
        const time = now()
        if (wire.bufferedAmount === 0 && !held.has(key) && time >= due) {
          presenceAt.set(message.tabId, time)
          return write(data)
        }
        return hold(key, { tabId: message.tabId, data, due })
      }
      if (message.type === 'left') {
        presenceAt.delete(message.tabId)
        for (const [key, h] of held) if (h.tabId === message.tabId) held.delete(key)
      }
      write(data)
    },
    end,
  }
}
