// A tab's sends at a pace (D4), as FigCraft's `Paced` (collab-net throttle.rs): messages that must all go,
// in order, a burst of them at once and then a steady rate, counted as they go, so a long queue
// (everything made offline, sent when the connection comes back) never trips the sync server's
// rate limit (`apps/sync/src/limits.ts`: 200 a second, bursts of 600) and leaves room for previews
// and pings.

/** How many messages go at once, and how many a second after that. */
export const PACE_BURST = 200
export const PACE_RATE = 60

export class Paced<T> {
  #tokens = PACE_BURST
  #last: number
  #queue: T[] = []

  /** A pacer starting at `now`, in milliseconds. */
  constructor(now: number) {
    this.#last = now
  }

  push(item: T) {
    this.#queue.push(item)
  }

  /** The next message, if its turn has come at `now`. */
  takeDue(now: number): T | undefined {
    if (this.#queue.length === 0) return undefined
    this.#tokens = Math.min(PACE_BURST, this.#tokens + ((now - this.#last) / 1000) * PACE_RATE)
    this.#last = now
    // Within rounding of a whole turn counts as one: the time `due` gave has come.
    if (this.#tokens < 1 - 1e-6) return undefined
    this.#tokens -= 1
    return this.#queue.shift()
  }

  /** When the next message's turn comes, in milliseconds (undefined: none waits). */
  due(): number | undefined {
    if (this.#queue.length === 0) return undefined
    return this.#last + (Math.max(0, 1 - this.#tokens) / PACE_RATE) * 1000
  }

  get size(): number {
    return this.#queue.length
  }

  /** Drops what waits: the connection closed, and the next one starts with its hello. */
  clear() {
    this.#queue = []
  }
}
