import { describe, expect, it } from 'vitest'

import { passed, stepTimings, summarize } from './timings.ts'

describe('stepTimings', () => {
  it('times what finished, counts what failed, and counts what still waits as taking its time so far', () => {
    let time = 0
    const timings = stepTimings(() => time)
    const fast = timings.start('edit')
    const broken = timings.start('edit')
    const stuck = timings.start('upload')
    time = 200
    fast.done()
    broken.failed()
    // Only the first end counts.
    fast.failed()
    broken.done()
    time = 5000
    const summaries = timings.summaries()
    expect(summaries.edit).toEqual({ count: 1, median: 200, slowest: 200, failures: 1 })
    expect(summaries.upload).toEqual({ count: 1, median: 5000, slowest: 5000, failures: 0 })
    expect(summaries.open).toEqual({ count: 0, median: 0, slowest: 0, failures: 0 })
    stuck.done()
    expect(timings.summaries().upload).toEqual({ count: 1, median: 5000, slowest: 5000, failures: 0 })
  })
})

describe('passed', () => {
  it('passes the median past 1 s, the slowest past 3 s, and any failure', () => {
    expect(passed({ count: 3, median: 1000, slowest: 3000, failures: 0 })).toEqual({
      median: false,
      slowest: false,
      failures: false,
    })
    expect(passed({ count: 3, median: 1001, slowest: 3001, failures: 1 })).toEqual({
      median: true,
      slowest: true,
      failures: true,
    })
  })
})

describe('summarize', () => {
  it('gives the middle time, or the mean of the two middle ones, and the slowest', () => {
    expect(summarize([300, 100, 200], 0)).toEqual({ count: 3, median: 200, slowest: 300, failures: 0 })
    expect(summarize([400, 100, 200, 300], 2)).toEqual({ count: 4, median: 250, slowest: 400, failures: 2 })
    expect(summarize([], 0)).toEqual({ count: 0, median: 0, slowest: 0, failures: 0 })
  })
})
