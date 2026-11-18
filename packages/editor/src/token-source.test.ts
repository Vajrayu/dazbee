import { describe, expect, it } from 'vitest'

import type { Member, SyncToken } from '@dazbee/schema'

import { TokenRefused, tokenSource } from './token-source.ts'

/** A clock that only moves when the source waits, and a fetch that gives `answers` in turn: a token, a failure, or the API's no. */
function rig(answers: (SyncToken | Error | null)[], member?: Member) {
  let now = 0
  const fetched: number[] = []
  const fetch = () => {
    fetched.push(now)
    const answer = answers.length > 0 ? (answers.shift() as SyncToken | Error | null) : new Error('no more answers')
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer)
  }
  const wait = (ms: number) => {
    now += ms
    return Promise.resolve()
  }
  return { source: tokenSource({ fetch, now: () => now, wait, ...(member ? { member } : {}) }), fetched }
}

const ANN: Member = { userId: 'ann', workspaceId: 'w1' }
const token = (name: string, expiresAt: number, member: Member = ANN): SyncToken => ({
  token: name,
  expiresAt: new Date(expiresAt).toISOString(),
  member,
})
const down = new Error('the API did not answer')

describe('tokenSource', () => {
  it('fetches a token, and refuses at once when the first fetch fails, with no token to fall back on', async () => {
    expect(await rig([token('a', 600_000)]).source()).toBe('a')
    await expect(rig([down]).source()).rejects.toThrow('did not answer')
  })

  it('retries a failed fetch with backoff until the token it has expires, then gives up', async () => {
    const { source, fetched } = rig([token('a', 60_000), down, down, token('b', 660_000)])
    expect(await source()).toBe('a')
    expect(await source()).toBe('b')
    expect(fetched).toEqual([0, 0, 1000, 3000])

    const failing = rig([token('a', 10_000), down, down, down, down, down, token('late', 1)])
    expect(await failing.source()).toBe('a')
    await expect(failing.source()).rejects.toThrow('did not answer')
    expect(failing.fetched.at(-1)).toBeLessThan(10_000)
  })

  it('stops asking once the API says no: that ask fails at once, though the token in hand is good, and every ask after it fails without fetching', async () => {
    const { source, fetched } = rig([token('a', 600_000), null, token('b', 1_200_000)])
    expect(await source()).toBe('a')
    await expect(source()).rejects.toThrow()
    await expect(source()).rejects.toThrow()
    expect(fetched).toEqual([0, 0])
  })

  it('refuses a token for another member than the page’s, for good: someone else signed in since the page was kept (C44)', async () => {
    const { source, fetched } = rig(
      [token('bo', 60_000, { userId: 'bo', workspaceId: 'w1' }), token('ann', 60_000)],
      ANN,
    )
    await expect(source()).rejects.toThrow(TokenRefused)
    await expect(source()).rejects.toThrow(TokenRefused)
    expect(fetched).toHaveLength(1)
    const same = rig([token('ann', 60_000)], ANN)
    await expect(same.source()).resolves.toBe('ann')
  })

  it('gives every ask made while a fetch is on its way that same fetch', async () => {
    const { source, fetched } = rig([token('a', 60_000), token('b', 660_000)])
    await source()
    expect(await Promise.all([source(), source()])).toEqual(['b', 'b'])
    expect(fetched).toHaveLength(2)
  })
})
