// Previews (D7): the tuples a preview travels as, the latest preview per tab and when it clears, and
// a tab's side: what it previews of its open step, and what it draws of others' (I4, C41).
import { describe, expect, it } from 'vitest'

import type { Change, Target } from '@dazbee/schema'

import { testDesign } from '../test-design.ts'
import { type Client, openClient, type Outgoing } from './client.ts'
import { fromTuples, previews, toTuples } from './previews.ts'
import { DesignState } from './state.ts'
import { comeBack, down, edit, exchange, joinClient, testServer, up, who, wire } from './test-session.ts'

const prop = (id: string, key: string): Target => ({ part: 'layer', id, key: 'props', prop: key })
const name = (id: string): Target => ({ part: 'layer', id, key: 'name' })
const set = (value: Target, to: unknown): Change => ({ op: 'set', value, to })
const moveBox = (x: number) => [set(prop('box', 'x'), x)]

/** `c` opens a step that writes `changes` and previews it. */
function previewing(c: Client, ...changes: Change[]): Outgoing {
  c.open()
  for (const change of changes) c.write(change)
  const message = c.preview()
  if (!message) throw new Error('no preview')
  return message
}

/** The box's x as tab `c` draws it, and as its working design holds it. */
const boxX = (c: Client) =>
  [c.shown().get('layer', 'box')?.props, c.working().get('layer', 'box')?.props].map(
    (props) => (props as { x: number }).x,
  )

describe('previews', () => {
  const state = () => DesignState.fromRecords(wire(testDesign()) as never)

  it('keeps the latest preview of each tab, and an empty one clears it', () => {
    const shown = previews()
    expect([...shown.take(2, 0, moveBox(10))]).toEqual(['layer/box'])
    shown.take(2, 0, moveBox(20))
    expect(shown.all()).toEqual(new Map([[2, moveBox(20)]]))
    expect([...shown.take(2, 0, [])]).toEqual(['layer/box'])
    expect(shown.all().size).toBe(0)
  })

  it('clears a tab’s preview when a change set it made after it is accepted, and ignores one older than that', () => {
    const shown = previews()
    shown.take(2, 3, moveBox(10))
    // Its change set 3 came before the step: the preview stays.
    expect(shown.accepted(2, 3).size).toBe(0)
    expect([...shown.accepted(2, 4)]).toEqual(['layer/box'])
    // A preview of the step that change set 4 ended, arriving late, is ignored.
    expect(shown.take(2, 3, moveBox(30)).size).toBe(0)
    expect(shown.all().size).toBe(0)
  })

  it('takes a tab’s previews again after everyone’s were cleared, whatever change sets it had accepted', () => {
    const shown = previews()
    shown.take(2, 5, moveBox(10))
    shown.accepted(2, 9)
    // Under a new sync id, tab ids and change set ids start again.
    shown.clear()
    expect(shown.take(2, 1, moveBox(20)).size).toBe(1)
  })

  it('clears one tab’s preview when it leaves, and everyone’s when the tab catches up anew', () => {
    const shown = previews()
    shown.take(2, 0, moveBox(10))
    shown.take(3, 0, [set(name('headline'), 'Theirs')])
    shown.clear(2)
    expect([...shown.all().keys()]).toEqual([3])
    shown.clear()
    expect(shown.all().size).toBe(0)
  })

  it('draws the previews by tab id, the tab’s own open step on top (C41), and leaves out a record the schema refuses', () => {
    const shown = previews()
    shown.take(3, 0, moveBox(30))
    shown.take(2, 0, [...moveBox(20), set(name('headline'), 'Theirs')])
    shown.take(4, 0, [set(prop('banner-box', 'opacity'), 'not a number')])
    const under = state()
    const drawn = shown.shown(under, moveBox(99))
    expect(drawn.get('layer', 'box')?.props).toMatchObject({ x: 99 })
    expect(shown.shown(under, []).get('layer', 'box')?.props).toMatchObject({ x: 30 })
    expect(drawn.get('layer', 'headline')).toMatchObject({ name: 'Theirs' })
    expect(drawn.get('layer', 'banner-box')).toBe(under.get('layer', 'banner-box'))
    // Drawing never writes the design under it.
    expect(under.get('layer', 'box')).toEqual(state().get('layer', 'box'))
  })
})

describe('toTuples', () => {
  it('writes a set, an unset, a create and a delete as compact tuples', () => {
    const record = { name: 'Page', order: 'a1' }
    const changes: Change[] = [
      set(prop('box', 'x'), 10),
      { op: 'set', value: prop('box', 'rotation') },
      set(name('box'), 'Box'),
      { op: 'create', part: 'page', id: 'p2', record },
      { op: 'delete', part: 'layer', id: 'box' },
    ]
    expect(toTuples(changes)).toEqual([
      ['s', 'layer', 'box', 'props', 'x', 10],
      ['u', 'layer', 'box', 'props', 'rotation'],
      ['s', 'layer', 'box', 'name', null, 'Box'],
      ['c', 'page', 'p2', record],
      ['d', 'layer', 'box'],
    ])
  })

  it('makes a 50-layer drag about half the size of its changes', () => {
    const id = (n: number) => `${'x'.repeat(19)}${String(n).padStart(2, '0')}`
    const drag = Array.from({ length: 50 }, (_, n) => [set(prop(id(n), 'x'), 120.5 + n), set(prop(id(n), 'y'), 80.25)])
    const [tuples, changes] = [JSON.stringify(toTuples(drag.flat())), JSON.stringify(drag.flat())]
    expect(tuples.length).toBeLessThan(6000)
    expect(tuples.length / changes.length).toBeLessThan(0.6)
  })
})

describe('fromTuples', () => {
  it('gives back the changes the tuples were made from', () => {
    const changes: Change[] = [
      set(prop('box', 'x'), 10),
      { op: 'set', value: prop('box', 'rotation') },
      set(name('box'), 'Box'),
      { op: 'create', part: 'layer', id: 'n', record: { type: 'box' } },
      { op: 'delete', part: 'frame', id: 'sq' },
    ]
    expect(fromTuples(wire(toTuples(changes)))).toEqual(changes)
  })
})

describe('openClient’s previews', () => {
  it('previews the open step’s net changes, after the last change set it made', () => {
    const server = testServer()
    const [a, b] = [joinClient(server), joinClient(server)]
    exchange(server, a, edit(a, 'rename', set(name('headline'), 'First')), [a, b])
    a.open()
    a.write(set(prop('box', 'x'), 10))
    a.write(set(prop('box', 'x'), 20))
    expect(a.preview()).toEqual({ type: 'preview', after: 1, changes: [['s', 'layer', 'box', 'props', 'x', 20]] })
    // A step that wrote back what was there previews nothing.
    a.write(set(prop('box', 'x'), (server.state().get('layer', 'box')?.props as { x: number }).x))
    expect(a.preview()).toEqual({ type: 'preview', after: 1, changes: [] })
  })

  it('previews nothing with no step open, offline, as a viewer, or past a preview’s size', () => {
    const server = testServer()
    const a = joinClient(server, who(), { limits: { previewBytes: 200 } })
    expect(a.preview()).toBeUndefined()
    previewing(a, ...moveBox(10))
    // Grown past the size, the step clears the preview that went out, then sends none.
    a.write(set(name('box'), 'x'.repeat(300)))
    expect(a.preview()).toEqual({ type: 'preview', after: 0, changes: [] })
    expect(a.preview()).toBeUndefined()
    a.cancel()
    a.disconnect()
    a.open()
    a.write(set(name('box'), 'Offline'))
    expect(a.preview()).toBeUndefined()
    a.cancel()
    const viewer = joinClient(server, who(undefined, 'view'))
    viewer.open()
    expect(viewer.preview()).toBeUndefined()
  })

  it('sends a cleared preview when a previewed step is cancelled or ends with nothing to send', () => {
    const server = testServer()
    const a = joinClient(server)
    previewing(a, ...moveBox(10))
    expect(a.cancel()).toEqual([{ type: 'preview', after: 0, changes: [] }])
    a.open()
    a.write(set(name('box'), 'Not previewed'))
    expect(a.cancel()).toEqual([])
    previewing(a, set(name('box'), (server.state().get('layer', 'box') as { name: string }).name))
    expect(a.end('rename')).toEqual([{ type: 'preview', after: 0, changes: [] }])
  })

  it('draws another tab’s preview, never in its working or confirmed design (I4), under its own open step (C41)', () => {
    const server = testServer()
    const [a, b] = [joinClient(server), joinClient(server)]
    const told: string[][] = []
    b.onPreview((changed) => told.push([...changed]))
    let changed = 0
    b.onChange(() => changed++)
    const confirmed = b.confirmed().toRecords()
    down(b, up(server, a, [previewing(a, ...moveBox(10))]))
    expect(boxX(b)).toEqual([10, 100])
    expect([told, changed, b.confirmed().toRecords()]).toEqual([[['layer/box']], 0, confirmed])
    b.open()
    b.write(set(prop('box', 'x'), 55))
    expect(boxX(b)).toEqual([55, 55])
  })

  it('clears a tab’s preview when its change set is accepted, and ignores a preview of that step arriving late', () => {
    const server = testServer()
    const [a, b] = [joinClient(server), joinClient(server)]
    const late = up(server, a, [previewing(a, ...moveBox(10))])
    down(b, late)
    expect(b.previews().size).toBe(1)
    exchange(server, a, a.end('move'), [a, b])
    expect(b.previews().size).toBe(0)
    // The same preview arriving again, late, is ignored.
    down(b, late)
    expect([b.previews().size, boxX(b)]).toEqual([0, [10, 10]])
  })

  it('clears a tab’s preview when its step is cancelled, when its change set is rejected, and when it leaves', () => {
    const server = testServer()
    const [a, b, c] = [joinClient(server), joinClient(server), joinClient(server)]
    down(b, up(server, a, [previewing(a, ...moveBox(10))]))
    down(b, up(server, a, a.cancel()))
    expect(b.previews().size).toBe(0)
    // c deletes the box; a's step on it is rejected, and the server clears its preview for the others.
    down(b, up(server, a, [previewing(a, ...moveBox(20))]))
    const sent = a.end('move')
    exchange(server, c, edit(c, 'delete', { op: 'delete', part: 'layer', id: 'box' }), [b, c])
    down(b, up(server, a, sent))
    expect(b.previews().size).toBe(0)
    down(b, up(server, a, [previewing(a, set(name('headline'), 'Mine'))]))
    b.receive({ type: 'left', tabId: a.tabId() })
    expect(b.previews().size).toBe(0)
  })

  it('drops every preview as its connection drops, telling the canvas, and keeps none to show offline', () => {
    const server = testServer()
    const [a, b] = [joinClient(server), joinClient(server)]
    down(b, up(server, a, [previewing(a, ...moveBox(10))]))
    const told: string[][] = []
    b.onPreview((changed) => told.push([...changed]))
    b.disconnect()
    expect([b.previews().size, boxX(b), told]).toEqual([0, [100, 100], [['layer/box']]])
  })

  it('clears every preview when it comes back, with the missed change sets or the whole design', () => {
    const server = testServer(undefined, { limits: { logChangeSets: 1 } })
    const [a, b] = [joinClient(server), joinClient(server)]
    down(b, up(server, a, [previewing(a, ...moveBox(10))]))
    a.cancel()
    expect(comeBack(server, b)).toEqual([])
    expect(b.previews().size).toBe(0)
    down(b, up(server, a, [previewing(a, ...moveBox(10))]))
    // b misses what follows: a's cancel, and more change sets than the log keeps.
    a.cancel()
    exchange(server, a, edit(a, 'rename', set(name('headline'), 'One')), [a])
    exchange(server, a, edit(a, 'rename', set(name('headline'), 'Two')), [a])
    expect(comeBack(server, b)).toEqual([])
    expect(b.previews().size).toBe(0)
  })

  it('previews none it gets from itself, and starts with none after a reload', () => {
    const server = testServer()
    const a = joinClient(server)
    a.receive({ type: 'preview', tabId: a.tabId(), after: 0, changes: [['s', 'layer', 'box', 'name', null, 'x']] })
    expect(a.previews().size).toBe(0)
    expect(openClient(wire(a.save())).previews().size).toBe(0)
  })
})
