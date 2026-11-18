// The idle keeper on its own, keyed by design id: a released design stays released for every unload
// that asks, until it wakes or is forgotten, and the longest idle is released past the most kept.
import { describe, expect, it } from 'vitest'

import { idleDesigns } from './idle.ts'

describe('idleDesigns', () => {
  it('keeps a released design released for every unload that asks, until it is forgotten', () => {
    const idle = idleDesigns<string>({ idleMs: 60_000, idleDesigns: 50 })
    let unloads = 0
    expect(idle.mayUnload('a', () => unloads++)).toBe(false)
    expect(idle.releaseLongest()).toBe(true)
    expect(unloads).toBe(1)
    // Asked again, it is still released.
    expect(idle.mayUnload('a', () => unloads++)).toBe(true)
    expect(idle.mayUnload('a', () => unloads++)).toBe(true)
    idle.forget('a')
    expect(idle.mayUnload('a', () => unloads++)).toBe(false)
    expect(idle.releaseLongest()).toBe(true)
    expect(idle.releaseLongest()).toBe(false)
  })

  it('releases the longest idle once more are idle than the most kept, until it wakes', () => {
    const idle = idleDesigns<string>({ idleMs: 60_000, idleDesigns: 1 })
    expect(idle.mayUnload('one', () => {})).toBe(false)
    // A second idle design past the most kept releases the longest idle.
    expect(idle.mayUnload('two', () => {})).toBe(false)
    expect(idle.mayUnload('one', () => {})).toBe(true)
    idle.wake('one')
    expect(idle.mayUnload('one', () => {})).toBe(false)
  })
})
