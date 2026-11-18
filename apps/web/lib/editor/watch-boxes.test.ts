import { describe, expect, it } from 'vitest'

import { watchOnly } from './watch-boxes.ts'

/** An observer that records what it watches. */
function fakeObserver() {
  const seen = new Set<object>()
  return {
    seen,
    observe: (it: object) => void seen.add(it),
    unobserve: (it: object) => void seen.delete(it),
  }
}

describe('watchOnly', () => {
  it('watches the elements given, and stops watching those no longer given', () => {
    const observer = fakeObserver()
    const watched = new Set<object>()
    const [a, b, c] = [{}, {}, {}]
    watchOnly(observer, watched, [a, b])
    expect([...observer.seen]).toEqual([a, b])
    // b is removed from the page and c mounts in its place.
    watchOnly(observer, watched, [a, c])
    expect([...observer.seen]).toEqual([a, c])
    expect([...watched]).toEqual([a, c])
  })

  it('observes an element once however often it is given', () => {
    let observed = 0
    const watched = new Set<object>()
    const observer = { observe: () => void observed++, unobserve: () => {} }
    const a = {}
    watchOnly(observer, watched, [a])
    watchOnly(observer, watched, [a, a])
    expect(observed).toBe(1)
  })
})
