// The designs the sync server keeps loaded with no tab connected, so a tab that leaves and comes
// back over and over costs no load: each stays `idleMs` after its last tab leaves, and at most
// `idleDesigns` are kept, the longest idle released first. Each is kept by its design id, and the
// longest idle is released early to stay under the server's byte budget (D11).
import type { Limits } from './limits.ts'

export interface IdleDesigns<K> {
  /**
   * Whether a design with no tab may unload now: once released, or while the server closes.
   * Otherwise it is kept from now, and `unload` unloads it once it is released.
   */
  mayUnload(design: K, unload: () => void): boolean
  /** A tab connected to the design: it is no longer idle. */
  wake(design: K): void
  /** The design is unloaded: its release is forgotten. */
  forget(design: K): void
  /** Releases the longest-idle kept design now, if any: whether there was one. */
  releaseLongest(): boolean
  /** Releases every kept design at once, as the server closes; every unload from now goes ahead. */
  releaseAll(): void
}

/** Keeps idle designs loaded for `idleMs`, at most `idleDesigns` of them. */
export function idleDesigns<K extends string>({
  idleMs,
  idleDesigns: most,
}: Pick<Limits, 'idleMs' | 'idleDesigns'>): IdleDesigns<K> {
  /** The kept designs, longest idle first, each with the timer that releases it and what unloads it. */
  const kept = new Map<K, { timer: ReturnType<typeof setTimeout>; unload: () => void }>()
  // A design released stays released until it wakes or is forgotten.
  const released = new Set<K>()
  let closing = false

  const release = (design: K) => {
    const entry = kept.get(design)
    clearTimeout(entry?.timer)
    kept.delete(design)
    released.add(design)
    entry?.unload()
  }

  return {
    mayUnload(design, unload) {
      if (closing || released.has(design)) return true
      if (!kept.has(design)) {
        kept.set(design, { timer: setTimeout(() => release(design), idleMs), unload })
        const longest = kept.keys().next().value
        if (kept.size > most && longest) release(longest)
      }
      return false
    },
    wake(design) {
      clearTimeout(kept.get(design)?.timer)
      kept.delete(design)
      released.delete(design)
    },
    forget(design) {
      released.delete(design)
    },
    releaseLongest() {
      const longest = kept.keys().next()
      if (longest.done) return false
      release(longest.value)
      return true
    },
    releaseAll() {
      closing = true
      for (const design of [...kept.keys()]) release(design)
    },
  }
}
