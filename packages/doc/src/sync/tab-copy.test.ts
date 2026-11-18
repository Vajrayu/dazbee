// A tab copy written as entries (D9): a step writes only small ones, the log folds when the tab is
// idle, and the entries always add up to what the client saves.
import { describe, expect, it } from 'vitest'

import type { Accepted, Change, RestoreMark, Target } from '@dazbee/schema'

import { linkedDesign } from '../test-design.ts'
import { type Client, openClient, type SavedClient } from './client.ts'
import type { Outgoing } from './server.ts'
import { type Entries, FOLD_LOG, putEntries, restoreEntries, TabCopy } from './tab-copy.ts'
import { down, edit, joinClient, testServer, up, who, wire } from './test-session.ts'
import { groupHeights, withGroupHeights } from './test-sim-edits.ts'

const name = (part: 'page' | 'layer', id: string): Target => ({ part, id, key: 'name' })
const set = (value: Target, to: unknown): Change => ({ op: 'set', value, to })

/** A tab's copy, kept as it writes it. */
function copyOf(c: Client) {
  const copy = new TabCopy()
  const entries: Entries = new Map()
  let heard: Accepted[] = []
  /** Writes the copy; returns what the write put and removed. */
  const write = () => {
    const written = copy.write(wire(c.save()), heard)
    putEntries(entries, written)
    heard = []
    return written
  }
  /** Delivers `out` to the tab, keeping the change sets it takes. */
  const take = (out: readonly Outgoing[]) => {
    for (const { to, except, message } of out) {
      if ((to !== 'all' && to !== c.tabId()) || except === c.tabId() || message.type !== 'accepted') continue
      const { seq, author, changeSetId, changes } = wire(message)
      heard.push({ seq, author, changeSetId, changes })
    }
    return down(c, out)
  }
  return { entries, write, take }
}

describe('TabCopy', () => {
  it('writes the whole design once, then a step writes its queue entry and another tab’s change set a log entry', () => {
    const server = testServer(linkedDesign())
    const [a, b] = [joinClient(server), joinClient(server)]
    const copy = copyOf(a)
    const first = copy.write()
    expect([...first.put.keys()].sort()).toEqual(['head', 'tab'])
    // a's step waits in its queue: one small entry, and the head's next id.
    const sent = edit(a, 'rename', set(name('layer', 'title'), 'Mine'))
    const step = copy.write()
    expect([[...step.put.keys()].sort(), step.remove]).toEqual([['head', 'queue/1'], []])
    expect(step.bytes).toBeLessThan(first.bytes / 5)
    // b's change set lands first; then a's own: each is one log entry, and a's queue entry goes.
    copy.take(up(server, b, edit(b, 'rename', set(name('layer', 'price'), 'Theirs'))))
    copy.take(up(server, a, sent))
    const landed = copy.write()
    expect([[...landed.put.keys()].sort(), landed.remove]).toEqual([['log/1', 'log/2'], ['queue/1']])
  })

  it('keeps a queued restore’s mark in its entries', () => {
    const a = joinClient(testServer(linkedDesign()))
    const copy = copyOf(a)
    const mark: RestoreMark = { versionId: 'v1', kind: 'auto', name: '', takenAt: '2026-11-16T14:30:00.000Z' }
    a.open()
    a.write(set(name('page', 'p1'), 'Restored'))
    a.end('restore', mark)
    copy.write()
    expect(restoreEntries(copy.entries).queue).toMatchObject([{ kind: 'edit', restore: mark }])
    expect(restoreEntries(copy.entries)).toEqual(wire(a.save()))
  })

  it('folds the log into the design once the tab is idle and the log is long, and never while a change set waits', () => {
    const server = testServer(linkedDesign())
    const [a, b] = [joinClient(server), joinClient(server)]
    const copy = copyOf(a)
    copy.write()
    const theirs = (n: number) => copy.take(up(server, b, edit(b, 'rename', set(name('page', 'p1'), `P${n}`))))
    // Idle, with a log of exactly the limit: no fold yet.
    for (let n = 0; n < FOLD_LOG.changeSets; n++) theirs(n)
    expect(copy.write().put.has('tab')).toBe(false)
    // Past the limit while a's change set waits: still no fold.
    const sent = edit(a, 'rename', set(name('layer', 'title'), 'Waiting'))
    theirs(FOLD_LOG.changeSets)
    expect(copy.write().put.has('tab')).toBe(false)
    // a's own change set lands: the tab is idle, and the next write folds the log.
    copy.take(up(server, a, sent))
    const folded = copy.write()
    expect(folded.put.has('tab')).toBe(true)
    expect([...copy.entries.keys()].sort()).toEqual(['head', 'tab'])
    expect(restoreEntries(copy.entries)).toEqual(wire(a.save()))
  })

  it('writes the tab entry again when the log no longer leads to the confirmed design', () => {
    const server = testServer(linkedDesign(), { limits: { logChangeSets: 1 } })
    const [a, b] = [joinClient(server), joinClient(server)]
    const copy = copyOf(a)
    copy.write()
    // a misses two change sets and catches up with the whole design.
    up(server, b, edit(b, 'rename', set(name('page', 'p1'), 'One')))
    up(server, b, edit(b, 'rename', set(name('page', 'p1'), 'Two')))
    server.leave(a.tabId())
    a.disconnect()
    const joined = server.join(wire(a.reconnect('t')), who())
    if ('close' in joined) throw new Error(joined.reason)
    for (const { message } of joined.out) a.receive(wire(message))
    const rewritten = copy.write()
    expect(rewritten.put.has('tab')).toBe(true)
    expect(restoreEntries(copy.entries)).toEqual(wire(a.save()))
  })
})

describe('restoreEntries', () => {
  it('adds the entries up to exactly what the client saves: queue, steps shared and the open step', () => {
    const server = testServer(withGroupHeights(linkedDesign()))
    const options = { recompute: groupHeights }
    const [a, b] = [joinClient(server, undefined, options), joinClient(server)]
    const copy = copyOf(a)
    copy.write()
    const checks: SavedClient[] = []
    const check = () => {
      copy.write()
      const saved = wire(a.save())
      checks.push(saved)
      expect(restoreEntries(copy.entries)).toEqual(saved)
    }
    // b's change set crosses a's: a owes the group's height once its own lands.
    const move: Change[] = [
      set({ part: 'layer', id: 'badge', key: 'parentId' }, 'grp'),
      set({ part: 'layer', id: 'badge', key: 'index' }, 'a5'),
    ]
    const sent = edit(a, 'move', ...move)
    check()
    copy.take(up(server, b, edit(b, 'rename', set(name('layer', 'price'), 'Theirs'))))
    check()
    copy.take(up(server, a, sent))
    check()
    // An undo and its follow-up share one step; an open step comes back too.
    a.disconnect()
    a.undo()
    a.open()
    a.write(set(name('layer', 'title'), 'Open'))
    check()
    expect(checks.at(-1)?.queue.length).toBeGreaterThan(0)
    const back = openClient(restoreEntries(copy.entries), options)
    expect(back.working().toRecords()).toEqual(openClient(wire(a.save()), options).working().toRecords())
  })

  it('keeps the values a tab still owes while its recompute waits', () => {
    const server = testServer(withGroupHeights(linkedDesign()))
    const [a, b] = [joinClient(server, undefined, { recompute: () => 'wait' }), joinClient(server)]
    const copy = copyOf(a)
    copy.write()
    const sent = edit(a, 'move', set({ part: 'layer', id: 'badge', key: 'parentId' }, 'grp'))
    copy.take(up(server, b, edit(b, 'rename', set(name('layer', 'price'), 'Theirs'))))
    copy.take(up(server, a, sent))
    copy.write()
    const saved = wire(a.save())
    expect([saved.owed.length > 0, restoreEntries(copy.entries)]).toEqual([true, saved])
  })
})
