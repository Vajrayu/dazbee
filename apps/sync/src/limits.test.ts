// The sync server's message budget on its own: a burst at once, then the sustained rate.
import { describe, expect, it } from 'vitest'

import { LIMITS, messageRate } from './limits.ts'

describe('messageRate', () => {
  it('takes a burst at once, then the sustained rate', () => {
    let now = 0
    const take = messageRate({ ...LIMITS, messagesPerSecond: 60, messageBurst: 200 }, () => now)
    expect(Array.from({ length: 201 }, take).filter(Boolean)).toHaveLength(200)
    now += 1000
    expect(Array.from({ length: 61 }, take).filter(Boolean)).toHaveLength(60)
    now += 100_000
    expect(Array.from({ length: 300 }, take).filter(Boolean)).toHaveLength(200)
  })
})
