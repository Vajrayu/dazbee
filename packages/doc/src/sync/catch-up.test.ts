// A tab back after a long absence: the change sets it missed go on its confirmed design in one pass
// and its working design is rebuilt once; past `catchUpWork` of missed times waiting change sets it
// gets the whole design; and it sends what waited at a pace the sync server's rate limit takes.
import { describe, expect, it } from 'vitest'

import { type Change, SYNC_LIMITS } from '@dazbee/schema'

import { linkedDesign } from '../test-design.ts'
import { differenceOf } from '../test-walk.ts'
import type { Client, Outgoing } from './client.ts'
import { PACE_BURST, PACE_RATE, Paced } from './pacer.ts'
import { down, edit, exchange, joinClient, testServer, up, who, wire } from './test-session.ts'

const named = (id: string, name: string): Change => ({ op: 'set', value: { part: 'layer', id, key: 'name' }, to: name })
const moved = (id: string, x: number): Change => ({
  op: 'set',
  value: { part: 'layer', id, key: 'props', prop: 'x' },
  to: x,
})
const LAYERS = ['bg', 'grp', 'title', 'price', 'badge']

/**
 * `a` goes offline and makes `waiting` renames; `b` makes `missed` moves; `a` comes back. Returns
 * the catch-up's kind, how often `a`'s listeners were told during it, and what `a` sends then.
 */
function absence(missed: number, waiting: number) {
  const server = testServer(linkedDesign(), { limits: { logChangeSets: 1e9, logBytes: 1e12 } })
  const [a, b] = [joinClient(server), joinClient(server)]
  server.leave(a.tabId())
  a.disconnect()
  for (let n = 0; n < waiting; n++) edit(a, 'rename', named(LAYERS[n % 5] as string, `Mine ${n}`))
  for (let n = 0; n < missed; n++) down(b, up(server, b, edit(b, 'move', moved(LAYERS[n % 5] as string, n + 1))))
  let told = 0
  a.onChange(() => told++)
  const joined = server.join(wire(a.reconnect('t')), who())
  if ('close' in joined) throw new Error(joined.reason)
  const welcome = joined.out[0]?.message
  const kind = welcome?.type === 'welcome' ? ('design' in welcome.catchUp ? 'design' : 'changeSets') : undefined
  const sends = joined.out.flatMap(({ to, message }) => (to === joined.tabId ? a.receive(wire(message)) : []))
  return { server, a, b, kind, told, sends }
}

/** Delivers what `c` sends until nothing more is sent, then checks every tab holds the server's design. */
function settle(s: ReturnType<typeof absence>, c: Client, sends: Outgoing[]) {
  exchange(s.server, c, sends, [s.a, s.b])
  for (const tab of [s.a, s.b]) {
    expect(tab.queued()).toBe(0)
    expect(differenceOf(tab.working().toRecords(), s.server.state().toRecords())).toBeUndefined()
  }
}

describe('a tab back after a long absence', () => {
  it('takes the change sets it missed in one pass, telling its listeners once, and ends with the server’s design', () => {
    const s = absence(400, 30)
    expect([s.kind, s.told, s.sends.length]).toEqual(['changeSets', 1, 30])
    expect(s.a.seq()).toBe(s.server.seq())
    settle(s, s.a, s.sends)
    expect(s.a.working().get('layer', 'title')?.name).toBe('Mine 27')
  })

  it('gets the whole design when the missed change sets times its waiting ones pass catchUpWork', () => {
    const waiting = 200
    const s = absence(Math.floor(SYNC_LIMITS.catchUpWork / waiting) + 1, waiting)
    expect([s.kind, s.told]).toEqual(['design', 1])
    settle(s, s.a, s.sends)
    // Building hundreds of waiting change sets takes about 2.5 s alone and over 5 s on a busy CI runner.
  }, 20_000)
})

describe('a tab’s sends at a pace', () => {
  it('sends a queue of 5,000 within the sync server’s rate limit, a burst and then 60 a second', () => {
    // The sync server's budget per WebSocket: 200 a second, bursts of 600.
    const rate = { perSecond: 200, burst: 600 }
    let left = rate.burst
    let at = 0
    const takes = (now: number) => {
      left = Math.min(rate.burst, left + ((now - at) / 1000) * rate.perSecond)
      at = now
      if (left < 1) return false
      left -= 1
      return true
    }
    const paced = new Paced<number>(0)
    for (let n = 0; n < 5000; n++) paced.push(n)
    let now = 0
    const sent: number[] = []
    let burst = 0
    for (let message = paced.takeDue(now); paced.size > 0 || message !== undefined; message = paced.takeDue(now)) {
      if (message === undefined) {
        now = paced.due() as number
        continue
      }
      if (now === 0) burst++
      expect(takes(now)).toBe(true)
      sent.push(message)
    }
    expect([sent.length, sent[4999], burst]).toEqual([5000, 4999, PACE_BURST])
    // The rest at 60 a second: 80 s for 4,800.
    expect(now / 1000).toBeCloseTo((5000 - PACE_BURST) / PACE_RATE, 0)
  })

  it('drops what waits when its connection closes', () => {
    const paced = new Paced<number>(0)
    for (let n = 0; n < 3; n++) paced.push(n)
    paced.clear()
    expect([paced.size, paced.due(), paced.takeDue(1000)]).toEqual([0, undefined, undefined])
  })
})
