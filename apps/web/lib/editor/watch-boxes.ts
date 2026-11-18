// Keeping a resize observer on exactly the elements that matter now: the ones given are watched,
// and those no longer given, such as a panel that has since been removed, are let go.

/** The part of a ResizeObserver this needs. */
interface Observer<T> {
  observe(it: T): void
  unobserve(it: T): void
}

/** Watches each element of `now` not yet in `watched`, and stops watching each one `now` no longer holds. */
export function watchOnly<T>(observer: Observer<T>, watched: Set<T>, now: Iterable<T>) {
  const keep = new Set(now)
  for (const it of watched)
    if (!keep.has(it)) {
      observer.unobserve(it)
      watched.delete(it)
    }
  for (const it of keep)
    if (!watched.has(it)) {
      observer.observe(it)
      watched.add(it)
    }
}
