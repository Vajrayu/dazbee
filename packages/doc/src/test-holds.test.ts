// The timing tests' measure of a held event loop: what it gives for work, and for a wait without work.
import { describe, expect, it } from 'vitest'

import { holdOf, watchHolds } from './test-holds.ts'

/** Waits `ms`. */
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** The processor time this process has used so far, in ms. */
const worked = () => (process.cpuUsage().user + process.cpuUsage().system) / 1000

describe('holdOf', () => {
  it('gives how long work held the event loop, and next to nothing for a wait without work', () => {
    expect(
      holdOf(() => {
        const until = worked() + 100
        while (worked() < until);
      }),
    ).toBeGreaterThan(90)
    expect(holdOf(() => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100))).toBeLessThan(50)
  })
})

describe('watchHolds', () => {
  it('gives how long work held the event loop', async () => {
    const stop = watchHolds()
    await pause(20)
    const until = worked() + 300
    while (worked() < until);
    await pause(20)
    expect(stop()).toBeGreaterThan(250)
  })

  it('gives next to nothing for a wait that does no work, as when a busy machine keeps the process waiting', async () => {
    const stop = watchHolds()
    await pause(20)
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300)
    await pause(20)
    expect(stop()).toBeLessThan(100)
  })
})
