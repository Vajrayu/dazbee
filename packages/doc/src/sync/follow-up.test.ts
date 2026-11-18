// Derived values kept current after crossing edits (D6): what a follow-up writes, and a tab's rules
// for which records it owes one, on the toy derived value (a group's height is 10 plus 10 for each
// layer it holds), with tabs and a server wired by hand.
import { describe, expect, it } from 'vitest'

import type { Change, Target } from '@dazbee/schema'

import { linkedDesign } from '../test-design.ts'
import type { RecordKey } from './changes.ts'
import { type Client, type ClientOptions, FOLLOW_UP_WAIT_MS, openClient, type Outgoing } from './client.ts'
import { followUp, type Recompute, touchedBy } from './follow-up.ts'
import type { Server } from './server.ts'
import { DesignState } from './state.ts'
import { down, exchange, joinClient, testServer, up, who, wire } from './test-session.ts'
import { groupHeights, staleGroups, withGroupHeights, writeDerived } from './test-sim-edits.ts'

const set = (value: Target, to: unknown): Change => ({ op: 'set', value, to })
const height = (id: string, to: number) => set({ part: 'layer', id, key: 'props', prop: 'height' }, to)

/** A new box layer `id` in `holder`. */
function box(id: string, holder: string, index: string): Change {
  const props = { x: 0, y: 0, width: 10, height: 10, fills: [] }
  return {
    op: 'create',
    part: 'layer',
    id,
    record: { type: 'box', parentId: holder, link: id, index, name: id, props },
  }
}

/** Layer `id` moved into `holder`. */
const into = (id: string, holder: string, index: string): Change[] => [
  set({ part: 'layer', id, key: 'parentId' }, holder),
  set({ part: 'layer', id, key: 'index' }, index),
]

/** A server on the linked design with right heights (`grp` holds `title` and `price`: 30), and tabs with `recompute`. */
function session(tabs: number, recompute: Recompute = groupHeights, options: ClientOptions = {}) {
  const server = testServer(withGroupHeights(linkedDesign()))
  const clients = Array.from({ length: tabs }, () => joinClient(server, who(), { recompute, ...options }))
  return { server, clients }
}

/** One step on `c` that writes `changes` and the derived values over them, as a command does; returns what it sends. */
function step(c: Client, ...changes: Change[]): Outgoing[] {
  const before = DesignState.fromRecords(c.working().toRecords())
  c.open()
  for (const change of changes) c.write(change)
  writeDerived(c, before, groupHeights)
  return c.end('edit')
}

/** `groupHeights`, keeping each set of records it is asked about. */
function spied() {
  const asked: RecordKey[][] = []
  const recompute: Recompute = (state, touched) => {
    asked.push([...touched])
    return groupHeights(state, touched)
  }
  return { recompute, asked, about: (key: RecordKey) => asked.some((keys) => keys.includes(key)) }
}

/** `c` comes back on a new connection after it left the server; returns what it sends then. */
function back(server: Server, c: Client): Outgoing[] {
  const joined = server.join(wire(c.reconnect('t')), who())
  if ('close' in joined) throw new Error(joined.reason)
  return joined.out.flatMap(({ message }) => c.receive(wire(message)))
}

/** The follow-ups among `messages`, by the changes they carry. */
const followUps = (messages: readonly Outgoing[]) =>
  messages.flatMap((m) => (m.type === 'changes' && m.kind === 'followUp' ? [m.changes] : []))

describe('touchedBy', () => {
  it('gives the records written, with what held each before and what holds it after', () => {
    const before = DesignState.fromRecords(wire(linkedDesign()) as never)
    const after = before.overlay()
    for (const change of into('title', 'sq', 'a9')) after.apply(change, 'lenient')
    expect([...touchedBy(before, after, ['layer/title'])].sort()).toEqual(['frame/sq', 'layer/grp', 'layer/title'])
  })
})

describe('followUp', () => {
  it('writes what the recompute changes, and nothing it writes back to the value there', () => {
    const state = DesignState.fromRecords(wire(withGroupHeights(linkedDesign())) as never)
    const next = state.overlay()
    for (const change of into('badge', 'grp', 'a9')) next.apply(change, 'lenient')
    expect(followUp(next, new Set(['layer/grp', 'layer/story-grp']), groupHeights)).toEqual([height('grp', 40)])
    expect(followUp(state, new Set(['layer/grp']), groupHeights)).toEqual([])
    expect(followUp(state, new Set(['layer/grp']), () => 'wait')).toBe('wait')
  })
})

describe('openClient’s follow-ups', () => {
  it('sends a follow-up when another tab’s change set was ordered before its own, and the height ends right', () => {
    const { server, clients } = session(2)
    const [a, b] = clients as [Client, Client]
    const outA = up(server, a, step(a, box('a1', 'grp', 'a5')))
    const outB = up(server, b, step(b, box('b1', 'grp', 'a6')))
    // Both wrote 40 for the group; the server holds both layers.
    expect(staleGroups(server.state())).toEqual(['grp'])
    down(a, outA)
    down(a, outB)
    down(b, outA)
    const sent = down(b, outB)
    expect(followUps(sent)).toEqual([[height('grp', 50)]])
    exchange(server, b, sent, [a, b])
    expect([staleGroups(server.state()), a.owes(), b.owes()]).toEqual([[], false, false])
  })

  it('drops a follow-up over a change set’s limits, sending nothing, and owes its records no more (C39, D6, 5)', () => {
    // A recompute whose follow-up also writes a name too long for the limit.
    const long: Recompute = (state, touched) => {
      const worked = groupHeights(state, touched)
      return worked === 'wait' ? worked : [...worked, set({ part: 'layer', id: 'grp', key: 'name' }, 'x'.repeat(6000))]
    }
    const { server, clients } = session(2, long, { limits: { messageBytes: 5000 } })
    const [a, b] = clients as [Client, Client]
    const outA = up(server, a, step(a, box('a1', 'grp', 'a5')))
    const outB = up(server, b, step(b, box('b1', 'grp', 'a6')))
    down(b, outA)
    const sent = down(b, outB)
    expect(followUps(sent)).toEqual([])
    expect([b.queued(), b.owes()]).toEqual([0, false])
    // Not owed again by its own next change set.
    const later = step(b, set({ part: 'page', id: 'p1', key: 'name' }, 'Later'))
    expect(followUps(later)).toEqual([])
    expect(b.owes()).toBe(false)
  })

  it('works a follow-up out on the confirmed design with its whole queue on it (D6, 1)', () => {
    const { server, clients } = session(2)
    const [a, b] = clients as [Client, Client]
    const outA = up(server, a, step(a, box('a1', 'grp', 'a5')))
    // b's second change set waits in its queue while the first lands after a's.
    const outB = up(server, b, step(b, box('b1', 'grp', 'a6')))
    const second = step(b, box('b2', 'grp', 'a7'))
    down(b, outA)
    const sent = down(b, outB)
    // Title, price, a1, b1 and b2: the height its queue lands on, not the confirmed design's 50
    // (the prototype's seeds 68, 104 and 249).
    expect(followUps(sent)).toEqual([[height('grp', 60)]])
    exchange(server, b, [...second, ...sent], [b])
    expect([staleGroups(server.state()), followUps(sent).length]).toEqual([[], 1])
  })

  it('keeps a record owed until every change set made before it settles (D6, 2)', () => {
    const spy = spied()
    const { server, clients } = session(2, spy.recompute)
    const [a, b] = clients as [Client, Client]
    const outA = up(server, a, step(a, box('a1', 'grp', 'a5')))
    const outB = up(server, b, step(b, box('b1', 'grp', 'a6')))
    // b's rename was made before it came to owe the group's height (the prototype's seeds 232 and 3490).
    const outLater = up(server, b, step(b, set({ part: 'page', id: 'p1', key: 'name' }, 'Later')))
    down(b, outA)
    const sent = down(b, outB)
    expect(followUps(sent)).toEqual([[height('grp', 50)]])
    // Once the rename lands, the group is worked out again on what the queue holds now.
    spy.asked.length = 0
    down(b, outLater)
    expect(spy.about('layer/grp')).toBe(true)
    for (const out of [outA, outB, outLater]) down(a, out)
    exchange(server, b, sent, [a, b])
    expect([staleGroups(server.state()), b.owes()]).toEqual([[], false])
  })

  it('works out again what a rejected change set named, and what held it (D6, 3)', () => {
    const spy = spied()
    const { server, clients } = session(2, spy.recompute)
    const [a, b] = clients as [Client, Client]
    // a deletes the badge while b moves it into the group: b's change set is rejected (the prototype's seed 20).
    const outA = up(server, a, step(a, { op: 'delete', part: 'layer', id: 'badge' }))
    const outB = up(server, b, step(b, ...into('badge', 'grp', 'a9')))
    down(b, outA)
    spy.asked.length = 0
    down(b, outB)
    expect(['layer/badge', 'layer/grp', 'frame/sq'].map(spy.about)).toEqual([true, true, true])
    expect([staleGroups(server.state()), b.owes()]).toEqual([[], false])
  })

  it('works out again a change set’s values when one before it was rejected (D6, 4)', () => {
    const spy = spied()
    const { server, clients } = session(1, spy.recompute)
    const [b] = clients as [Client]
    // b's first change set writes what the schema refuses; its next was made on it.
    const rejected = up(server, b, step(b, set({ part: 'layer', id: 'badge', key: 'props', prop: 'opacity' }, 2)))
    const outB = up(server, b, step(b, box('b1', 'story-grp', 'a9')))
    down(b, rejected)
    spy.asked.length = 0
    down(b, outB)
    expect(spy.about('layer/story-grp')).toBe(true)
  })

  it('works out again a change set’s values when an undo before it was made again otherwise (D6, 4)', () => {
    const spy = spied()
    const { server, clients } = session(2, spy.recompute)
    const [a, b] = clients as [Client, Client]
    const name = (id: string): Target => ({ part: 'layer', id, key: 'name' })
    exchange(server, b, step(b, set(name('title'), 'Mine'), set(name('price'), 'Mine')), [a, b])
    // b's rename goes out; its undo waits behind it. a renames the price before the rename reaches the server.
    b.open()
    b.write(set({ part: 'page', id: 'p1', key: 'name' }, 'Zero'))
    const zero = b.end(null)
    expect(b.undo()).toEqual([])
    const outA = up(server, a, step(a, set(name('price'), 'Theirs')))
    const outZero = up(server, b, zero)
    down(b, outA)
    // b's next change set was made on the undo as it was shown, and waits behind it.
    expect(step(b, box('b1', 'story-grp', 'a9'))).toEqual([])
    // Made again, the undo leaves a's price alone.
    const sent = down(b, outZero)
    expect(sent.map((m) => m.type === 'changes' && [m.kind, m.changes.length])).toEqual([
      ['undo', 1],
      ['edit', 2],
    ])
    const outB = up(server, b, sent)
    spy.asked.length = 0
    down(b, outB)
    expect(spy.about('layer/story-grp')).toBe(true)
  })

  it('works out again, after a reload, the values a step left open wrote under another tab’s change set', () => {
    const { server, clients } = session(2)
    const [a, b] = clients as [Client, Client]
    const before = DesignState.fromRecords(a.working().toRecords())
    a.open()
    a.write(box('a1', 'grp', 'a5'))
    writeDerived(a, before, groupHeights)
    // b's change set lands under a's open step; a reloads with the step still open.
    exchange(server, b, step(b, box('b1', 'grp', 'a6')), [a, b])
    const saved = wire(a.save())
    server.leave(a.tabId())
    const reloaded = openClient(saved, { recompute: groupHeights })
    exchange(server, reloaded, back(server, reloaded), [reloaded])
    expect(staleGroups(server.state())).toEqual([])
  })

  it('keeps what it owes past its change sets renumbered after a reload from an older copy', () => {
    let waiting = false
    const fonts: Recompute = (state, touched) => (waiting ? 'wait' : groupHeights(state, touched))
    const { server, clients } = session(1, fonts)
    const [a] = clients as [Client]
    const older = wire(a.save())
    // Two change sets reach the server; then the tab reloads from the copy older than both.
    up(server, a, step(a, set({ part: 'page', id: 'p1', key: 'name' }, 'One')))
    up(server, a, step(a, set({ part: 'page', id: 'p1', key: 'name' }, 'Two')))
    a.disconnect()
    server.leave(a.tabId())
    const b = openClient(older, { recompute: fonts })
    step(b, ...into('badge', 'grp', 'a9'))
    waiting = true
    b.undo()
    waiting = false
    // Its move and undo take ids past the server's; what the undo owes waits for both to settle.
    back(server, b)
    expect([b.queued(), b.owes()]).toEqual([2, true])
  })

  it('sends no write again to a record whose follow-up was rejected, when a record it widens from is owed (D6, 5)', () => {
    // A recompute that writes what the schema refuses into the group for anything it is asked about.
    const broken: Recompute = (_, touched) =>
      touched.size > 0 ? [set({ part: 'layer', id: 'grp', key: 'props', prop: 'opacity' }, 2)] : []
    const { server, clients } = session(2, broken)
    const [a, b] = clients as [Client, Client]
    const outA = up(server, a, step(a, box('a1', 'grp', 'a5')))
    const outB = up(server, b, step(b, box('b1', 'grp', 'a6')))
    down(b, outA)
    const sent = down(b, outB)
    // b's next change set is rejected too (it writes what the schema refuses): what it named is owed again.
    const bad = step(b, set({ part: 'layer', id: 'badge', key: 'props', prop: 'opacity' }, 2))
    const rejected = up(server, b, [...sent, ...bad])
    expect(followUps(down(b, rejected))).toEqual([])
  })

  it('keeps what it owes across a reload', () => {
    const { server, clients } = session(2, () => 'wait')
    const [a, b] = clients as [Client, Client]
    const outA = up(server, a, step(a, box('a1', 'grp', 'a5')))
    const outB = up(server, b, step(b, box('b1', 'grp', 'a6')))
    down(b, outA)
    down(b, outB)
    expect([b.owes(), openClient(wire(b.save()), { recompute: () => 'wait' }).owes()]).toEqual([true, true])
  })

  it('works out again, after a whole-design catch-up, a group made in the gap that its settled change set took a layer out of (D6, 4)', () => {
    const server = testServer(withGroupHeights(linkedDesign()), { limits: { logChangeSets: 1 } })
    const [a, b] = [
      joinClient(server, who(), { recompute: groupHeights }),
      joinClient(server, who(), { recompute: groupHeights }),
    ]
    exchange(server, a, step(a, box('x1', 'grp', 'a5')), [a, b])
    // a makes a group holding the box; b, not having seen it, moves the box to another frame.
    const group: Change = {
      op: 'create',
      part: 'layer',
      id: 'g2',
      record: {
        type: 'group',
        parentId: 'sq',
        link: 'g2',
        index: 'a9',
        name: 'g2',
        props: { x: 0, y: 0, width: 10, height: 10 },
      },
    }
    const outA = up(server, a, step(a, group, ...into('x1', 'g2', 'a0')))
    // b's change set is accepted after a's, but its answer is lost with the connection.
    const outB = up(server, b, step(b, ...into('x1', 'wide', 'a9')))
    down(a, outA)
    down(a, outB)
    b.disconnect()
    server.leave(b.tabId())
    exchange(server, a, step(a, set({ part: 'page', id: 'p1', key: 'name' }, 'One')), [a])
    exchange(server, a, step(a, set({ part: 'page', id: 'p1', key: 'name' }, 'Two')), [a])
    // b catches up with the whole design: the group its box left, which it never saw, is worked out again.
    exchange(server, b, back(server, b), [a, b])
    expect([b.takeNotices(), staleGroups(a.working()), staleGroups(b.working())]).toEqual([[], [], []])
  })

  it('works out again, after a whole-design catch-up, what it settled and what its queue holds (D6, 4)', () => {
    const spy = spied()
    const server = testServer(withGroupHeights(linkedDesign()), { limits: { logChangeSets: 1 } })
    const [a, b] = [joinClient(server, who(), { recompute: groupHeights }), joinClient(server, who(), spy)]
    // b's first change set is accepted, but its answer is lost with the connection.
    down(a, up(server, b, step(b, box('b1', 'story-grp', 'a9'))))
    b.disconnect()
    server.leave(b.tabId())
    step(b, box('b2', 'grp', 'a9'))
    exchange(server, a, step(a, set({ part: 'page', id: 'p1', key: 'name' }, 'One')), [a])
    exchange(server, a, step(a, set({ part: 'page', id: 'p1', key: 'name' }, 'Two')), [a])
    spy.asked.length = 0
    const sent = back(server, b)
    // Whether a's change sets came before b's first isn't known: what it touched is worked out again.
    expect(spy.about('layer/story-grp')).toBe(true)
    spy.asked.length = 0
    exchange(server, b, sent, [a, b])
    expect(spy.about('layer/grp')).toBe(true)
  })

  it('sends an undo’s own follow-up, made again with the undo at the front of the queue', () => {
    const { server, clients } = session(2)
    const [a, b] = clients as [Client, Client]
    exchange(server, b, step(b, ...into('badge', 'grp', 'a9')), [a, b])
    exchange(server, a, step(a, box('a1', 'grp', 'a5')), [a, b])
    b.disconnect()
    server.leave(b.tabId())
    // The undo takes the badge out; a wrote the height since, so the undo's follow-up writes it: 40.
    expect(b.undo()).toEqual([])
    expect([b.queued(), b.kindOf(3)]).toEqual([2, 'followUp'])
    exchange(server, a, step(a, box('a2', 'grp', 'a6')), [a])
    // Made again at the front, after a's second layer: title, price, a1 and a2.
    const sent = back(server, b)
    expect(sent.map((m) => m.type === 'changes' && m.kind)).toEqual(['undo', 'followUp'])
    expect(followUps(sent)).toEqual([[height('grp', 50)]])
    exchange(server, b, sent, [a, b])
    expect(staleGroups(server.state())).toEqual([])
  })

  it('drops an undo’s own follow-up made again over a change set’s limits, and owes its records no more (C39)', () => {
    // A recompute whose follow-ups, once `long`, also write a name too long for the limit.
    let long = false
    const recompute: Recompute = (state, touched) => {
      const worked = groupHeights(state, touched)
      return worked === 'wait' || !long
        ? worked
        : [...worked, set({ part: 'layer', id: 'grp', key: 'name' }, 'x'.repeat(6000))]
    }
    const { server, clients } = session(2, recompute, { limits: { messageBytes: 5000 } })
    const [a, b] = clients as [Client, Client]
    exchange(server, b, step(b, ...into('badge', 'grp', 'a9')), [a, b])
    exchange(server, a, step(a, box('a1', 'grp', 'a5')), [a, b])
    b.disconnect()
    server.leave(b.tabId())
    expect(b.undo()).toEqual([])
    expect([b.queued(), b.kindOf(3)]).toEqual([2, 'followUp'])
    exchange(server, a, step(a, box('a2', 'grp', 'a6')), [a])
    // Made again at the front, its follow-up is over the limits: only the undo goes.
    long = true
    const sent = back(server, b)
    expect(sent.map((m) => m.type === 'changes' && m.kind)).toEqual(['undo'])
    exchange(server, b, sent, [a, b])
    expect([b.queued(), b.owes()]).toEqual([0, false])
    expect(server.state().get('layer', 'badge')?.parentId).not.toBe('grp')
  })

  it('owes no record again whose follow-up was rejected on the design it was worked out on, until it changes (D6, 5)', () => {
    let worked = 0
    // A recompute that writes what the schema refuses: the server rejects every follow-up it makes.
    const broken: Recompute = (state, touched) => {
      worked++
      return [...touched].flatMap((key) =>
        key === 'layer/grp' ? [set({ part: 'layer', id: 'grp', key: 'props', prop: 'opacity' }, 2)] : [],
      )
    }
    const { server, clients } = session(2, broken)
    const [a, b] = clients as [Client, Client]
    const outA = up(server, a, step(a, box('a1', 'grp', 'a5')))
    const outB = up(server, b, step(b, box('b1', 'grp', 'a6')))
    down(b, outA)
    const sent = down(b, outB)
    expect(followUps(sent)).toHaveLength(1)
    // Rejected, it is not worked out again: nothing goes, and nobody hears.
    expect(down(b, up(server, b, sent))).toEqual([])
    expect([b.owes(), b.takeNotices()]).toEqual([false, []])
    const once = worked
    // Rebuilt again, nothing is owed: no follow-up goes.
    expect(b.retryFollowUps()).toEqual([])
    expect(worked).toBe(once)
    // Once another tab's change set changes the group, it is owed again.
    exchange(server, a, step(a, set({ part: 'layer', id: 'grp', key: 'name' }, 'Renamed')), [b])
    expect(worked).toBeGreaterThan(once)
  })

  it('owes again at once a record whose follow-up was rejected after another tab changed it (D6, 5)', () => {
    const spy = spied()
    const { server, clients } = session(2, spy.recompute)
    const [a, b] = clients as [Client, Client]
    const outA = up(server, a, step(a, box('a1', 'grp', 'a5')))
    const outB = up(server, b, step(b, box('b1', 'grp', 'a6')))
    down(b, outA)
    const sent = down(b, outB)
    // a deletes the group before b's follow-up reaches the server: the follow-up is rejected.
    down(a, outA)
    down(a, outB)
    const gone = up(server, a, step(a, { op: 'delete', part: 'layer', id: 'grp' }))
    const rejected = up(server, b, sent)
    down(b, gone)
    spy.asked.length = 0
    down(b, rejected)
    expect(spy.about('layer/grp')).toBe(true)
  })

  it('drops a follow-up whose recompute waits past 30 seconds, and sends one that stops waiting in time (D6, 6)', () => {
    let clock = 1000
    let loading = true
    const fonts: Recompute = (state, touched) => (loading ? 'wait' : groupHeights(state, touched))
    const { server, clients } = session(2, fonts, { now: () => clock })
    const [a, b] = clients as [Client, Client]
    const crossing = () => {
      const outA = up(server, a, step(a, box(`a${clock}`, 'grp', `a${clock}`)))
      const outB = up(server, b, step(b, box(`b${clock}`, 'grp', `b${clock}`)))
      down(a, outA)
      down(a, outB)
      down(b, outA)
      return down(b, outB)
    }
    expect(followUps(crossing())).toEqual([])
    expect([b.owes(), b.followUpDeadline()]).toEqual([true, 1000 + FOLLOW_UP_WAIT_MS])
    // The font loads in time: the follow-up goes.
    loading = false
    clock += FOLLOW_UP_WAIT_MS - 1
    const sent = b.retryFollowUps()
    expect(followUps(sent)).toHaveLength(1)
    exchange(server, b, sent, [a, b])
    // A font that never loads: dropped at the deadline, with nothing sent.
    loading = true
    expect(followUps(crossing())).toEqual([])
    clock += FOLLOW_UP_WAIT_MS - 1
    expect([b.retryFollowUps(), b.owes()]).toEqual([[], true])
    clock += 1
    expect([b.retryFollowUps(), b.owes(), b.followUpDeadline()]).toEqual([[], false, undefined])
  })
})
