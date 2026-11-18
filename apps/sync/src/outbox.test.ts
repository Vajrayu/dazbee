// What goes out on one socket (D7, D10): a preview and a presence from each sender held while the
// socket is behind, only the latest kept; a `left` drops its sender's; a socket past `unsentBytes` ended.
import { describe, expect, it } from 'vitest'

import type { ServerMessage } from '@dazbee/schema'

import { outbox, type Wire } from './outbox.ts'
import { pause } from './test-sync.ts'

/** A wire whose bytes stay buffered until `drain`, as a socket whose tab reads slowly. */
function slowWire() {
  const sent: string[] = []
  const done: (() => void)[] = []
  const wire: Omit<Wire, 'bufferedAmount'> & {
    bufferedAmount: number
    sent: string[]
    drain(): void
    terminated: boolean
  } = {
    sent,
    bufferedAmount: 0,
    terminated: false,
    send(data, written) {
      sent.push(String(data))
      wire.bufferedAmount += String(data).length
      done.push(written)
    },
    terminate() {
      wire.terminated = true
    },
    drain() {
      wire.bufferedAmount = 0
      for (const written of done.splice(0)) written()
    },
  }
  return wire
}

const preview = (tabId: number, after: number): ServerMessage => ({ type: 'preview', tabId, after, changes: [] })
const presence = (tabId: number, x: number): ServerMessage => ({
  type: 'presence',
  tabId,
  person: tabId,
  colour: 0,
  presence: { page: 'p1', pointer: [x, 0], selection: [], frame: null },
})
const out = (box: ReturnType<typeof outbox>, message: ServerMessage) => box.send(JSON.stringify(message), message)
const kinds = (wire: { sent: string[] }) =>
  wire.sent.map((s) => {
    const m = JSON.parse(s) as ServerMessage
    if (m.type === 'presence') return `presence ${m.tabId}@${m.presence.pointer?.[0]}`
    return m.type === 'preview' ? `preview ${m.tabId}@${m.after}` : m.type
  })

describe('outbox', () => {
  it('sends at once while the socket keeps up', () => {
    const wire = slowWire()
    const box = outbox(wire, { unsentBytes: 1e6, ended: () => {} })
    out(box, preview(2, 1))
    wire.drain()
    out(box, preview(2, 2))
    expect(kinds(wire)).toEqual(['preview 2@1', 'preview 2@2'])
  })

  it("holds only each sender's latest preview while the socket is behind, and sends them once it drains", () => {
    const wire = slowWire()
    const box = outbox(wire, { unsentBytes: 1e6, ended: () => {} })
    out(box, { type: 'pong' })
    for (let n = 1; n <= 5; n++) {
      out(box, preview(2, n))
      out(box, preview(3, n))
    }
    out(box, { type: 'joined', tabId: 4, name: 'Cy' })
    expect(kinds(wire)).toEqual(['pong', 'joined'])
    wire.drain()
    expect(kinds(wire)).toEqual(['pong', 'joined', 'preview 2@5', 'preview 3@5'])
  })

  it("holds only each sender's latest presence beside its preview while the socket is behind, and drops both when it leaves", () => {
    const wire = slowWire()
    const box = outbox(wire, { unsentBytes: 1e6, ended: () => {} })
    out(box, { type: 'pong' })
    for (let n = 1; n <= 3; n++) {
      out(box, presence(2, n))
      out(box, preview(2, n))
      out(box, presence(3, n))
    }
    out(box, presence(4, 1))
    out(box, { type: 'left', tabId: 4 })
    expect(kinds(wire)).toEqual(['pong', 'left'])
    wire.drain()
    expect(kinds(wire)).toEqual(['pong', 'left', 'presence 2@3', 'preview 2@3', 'presence 3@3'])
  })

  it('sends at most so many presences a second from each sender, the latest waiting for its turn and never lost', async () => {
    const wire = slowWire()
    const clock = { now: 1000 }
    const box = outbox(wire, { unsentBytes: 1e6, ended: () => {}, presencePerSecond: 10, now: () => clock.now })
    const sent = () => {
      wire.drain()
      return kinds(wire)
    }
    out(box, presence(2, 1))
    expect(sent()).toEqual(['presence 2@1'])
    out(box, presence(2, 2))
    out(box, presence(3, 1))
    out(box, presence(2, 3))
    // Another sender's goes at once; the first sender's latest waits out the 100 ms since its last.
    expect(sent()).toEqual(['presence 2@1', 'presence 3@1'])
    clock.now = 1100
    await pause(150)
    expect(sent()).toEqual(['presence 2@1', 'presence 3@1', 'presence 2@3'])
    clock.now = 1300
    out(box, presence(2, 4))
    expect(sent().at(-1)).toBe('presence 2@4')
  })

  it("drops a sender's held preview when it leaves", () => {
    const wire = slowWire()
    const box = outbox(wire, { unsentBytes: 1e6, ended: () => {} })
    out(box, { type: 'pong' })
    out(box, preview(2, 1))
    out(box, preview(3, 1))
    out(box, { type: 'left', tabId: 2 })
    wire.drain()
    expect(kinds(wire)).toEqual(['pong', 'left', 'preview 3@1'])
  })

  it('sends what it holds once the socket drains with nothing more to send', async () => {
    const wire = slowWire()
    const box = outbox(wire, { unsentBytes: 1e6, ended: () => {} })
    out(box, { type: 'pong' })
    out(box, preview(2, 1))
    // The bytes leave without a write finishing here: a later check sends what was held.
    wire.bufferedAmount = 0
    await pause(100)
    expect(kinds(wire)).toEqual(['pong', 'preview 2@1'])
  })

  it('ends a socket that stopped reading, past what may wait for it', () => {
    const wire = slowWire()
    let ended = 0
    const box = outbox(wire, { unsentBytes: 10, ended: () => ended++ })
    out(box, { type: 'pong' })
    expect(wire.terminated).toBe(false)
    out(box, { type: 'pong' })
    expect([wire.terminated, ended]).toEqual([true, 1])
    out(box, { type: 'pong' })
    expect([kinds(wire), ended]).toEqual([['pong'], 1])
  })
})
