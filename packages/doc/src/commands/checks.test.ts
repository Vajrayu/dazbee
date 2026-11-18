import { nanoid } from 'nanoid'
import { describe, expect, it } from 'vitest'

import { type Design, parseDesign } from '@dazbee/schema'

import { type DesignStore, readDesign } from '../store.ts'
import { badge, openTestSession, testDesign, thrownBy } from '../test-design.ts'
import { openTestStore } from '../test-store.ts'
import { frameProblem, idProblem, missingLayer } from './checks.ts'
import { CommandError } from './define.ts'

const design = (): Design => {
  const result = parseDesign(testDesign())
  if (!result.success) throw new Error(result.errors.join('\n'))
  return result.design
}

describe('frameProblem', () => {
  it('names a frame the design lacks, and only that', () => {
    expect(frameProblem(design(), 'banner')).toBeUndefined()
    expect(frameProblem(design(), 'story')).toBe('no frame "story"')
    expect(frameProblem(design(), 'box')).toBe('no frame "box"')
    expect(frameProblem(design(), 'constructor')).toBe('no frame "constructor"')
  })
})

describe('lockFor', () => {
  it('lets a flip through only while the size and turn are unlocked, whatever the style lock', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    tab.run('node.lock', { ids: ['box'], lock: { style: true } })
    tab.run('node.update', { ids: ['box'], patch: { flipX: true, flipY: true } })
    expect(readDesign(store).nodes.box?.props).toMatchObject({ flipX: true, flipY: true })
    tab.run('node.lock', { ids: ['box'], lock: { style: false, resize: true } })
    expect(() => tab.run('node.update', { ids: ['box'], patch: { flipX: false } })).toThrow(
      /"box" is locked \(resize\)/,
    )
    expect(() => tab.run('node.update', { ids: ['box'], patch: { flipY: false } })).toThrow(
      /"box" is locked \(resize\)/,
    )
  })

  it('lets Lock ratio be set only while the size is unlocked, whatever the style lock', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    tab.run('node.lock', { ids: ['box'], lock: { style: true } })
    tab.run('node.update', { ids: ['box'], patch: { lockRatio: true } })
    expect(readDesign(store).nodes.box?.props).toMatchObject({ lockRatio: true })
    tab.run('node.lock', { ids: ['box'], lock: { style: false, resize: true } })
    expect(() => tab.run('node.update', { ids: ['box'], patch: { lockRatio: undefined } })).toThrow(
      /"box" is locked \(resize\)/,
    )
  })

  it("keeps a layer's constraints under the move lock alone", () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    const constraints = { horizontal: 'right', vertical: 'bottom' }
    tab.run('node.lock', { ids: ['box'], lock: { resize: true, content: true, style: true } })
    tab.run('node.update', { ids: ['box'], patch: { constraints } })
    expect(readDesign(store).nodes.box?.props).toMatchObject({ constraints })
    tab.run('node.lock', { ids: ['box'], lock: { move: true, resize: false, content: false, style: false } })
    expect(() =>
      tab.run('node.update', { ids: ['box'], patch: { constraints: { horizontal: 'left', vertical: 'top' } } }),
    ).toThrow(/"box" is locked \(move\)/)
    expect(readDesign(store).nodes.box?.props).toMatchObject({ constraints })
  })

  it('refuses constraints outside the enums, naming the path', () => {
    const tab = openTestSession(openTestStore())
    expect(() =>
      tab.run('node.update', { ids: ['box'], patch: { constraints: { horizontal: 'top', vertical: 'top' } } }),
    ).toThrow(/node.update: box.constraints.horizontal/)
  })
})

describe('missingLayer', () => {
  it('names the first id with no layer', () => {
    expect(missingLayer(design(), ['box', 'gone', 'lost'])).toBe('no layer "gone"')
  })

  it('is undefined when every id names a layer, or there are none', () => {
    expect(missingLayer(design(), ['box', 'headline'])).toBeUndefined()
    expect(missingLayer(design(), [])).toBeUndefined()
  })
})

describe('idProblem, through every command that takes a new id from its caller', () => {
  /**
   * A tab on the test design, with a second shape "dot", that once held ids it holds nothing under
   * now: the frame "gone", deleted with its layer, and the page "lost", deleted with its frame.
   */
  const named = () => {
    const store = openTestStore()
    const session = openTestSession(store)
    session.run('frame.add', { id: 'gone', pageId: 'p1', name: 'Gone', width: 100, height: 100 })
    session.run('node.create', { id: 'in-gone', parentId: 'gone', layer: badge })
    session.run('frame.delete', { frameId: 'gone' })
    session.run('page.add', {
      id: 'lost',
      name: 'Lost',
      frame: { id: 'lost-frame', name: 'Frame', width: 100, height: 100 },
    })
    session.run('page.delete', { id: 'lost' })
    session.run('node.create', { id: 'dot', parentId: 'sq', layer: badge })
    return { store, session }
  }
  const layer = {
    type: 'graphic',
    name: 'G',
    props: { x: 0, y: 0, width: 10, height: 10, shape: { kind: 'rect' } },
  } as const
  const square = { name: 'Square', width: 100, height: 100 }

  it.each([
    ['frame.add', { id: 'gone', pageId: 'p1', ...square }],
    ['frame.addSize', { frameId: 'sq', newId: 'gone', width: 300, height: 600 }],
    ['frame.duplicate', { frameId: 'sq', newId: 'lost' }],
    ['page.add', { id: 'lost', name: 'Page', frame: square }],
    ['page.add', { name: 'Page', frame: { id: 'gone', ...square } }],
    ['page.duplicate', { id: 'p1', newId: 'lost' }],
    ['node.create', { id: 'gone', parentId: 'sq', layer }],
    ['node.group', { ids: ['box', 'headline'], id: 'gone' }],
    ['node.box', { ids: ['box', 'headline'], id: 'lost' }],
    ['node.boolean', { ids: ['box', 'dot'], op: 'union', id: 'gone' }],
  ] as const)('%s takes an id the document once held, now free (C27): %j', (name, input) => {
    const { session } = named()
    expect(() => session.run(name, input as never)).not.toThrow()
  })

  it.each([
    ['a page', 'p1'],
    ['a frame', 'sq'],
    ['a layer', 'box'],
  ])("node.create refuses %s's live id, before writing", (_, id) => {
    const { store, session } = named()
    const before = readDesign(store)
    const refusal = thrownBy(() => session.run('node.create', { id, parentId: 'sq', layer }))
    expect(refusal).toBeInstanceOf(CommandError)
    expect(String(refusal)).toMatch(`id "${id}" is taken`)
    expect(readDesign(store)).toEqual(before)
  })
})

describe('idProblem', () => {
  /** A tab on `store` that added a page with a frame and deleted the page, and a check of an id on it. */
  const deleted = (store: DesignStore = openTestStore()) => {
    const session = openTestSession(store)
    session.run('page.add', {
      id: 'new-page',
      name: 'Added',
      frame: { id: 'new-frame', name: 'Frame', width: 300, height: 250 },
    })
    session.run('page.delete', { id: 'new-page' })
    const taken = (on: DesignStore, id: string) => idProblem({ w: on, design: readDesign(on), newId: nanoid }, id)
    return { store, session, taken }
  }

  it('takes a frame id whose page another command deleted, and undo takes that frame back before it brings the page back', () => {
    const { store, session, taken } = deleted()
    expect([taken(store, 'new-page'), taken(store, 'new-frame')]).toEqual([undefined, undefined])
    session.run('frame.add', { id: 'new-frame', pageId: 'p1', name: 'Added', width: 300, height: 250 })
    expect(taken(store, 'new-frame')).toBe('id "new-frame" is taken')
    session.undo()
    expect(readDesign(store).frames['new-frame']).toBeUndefined()
    session.undo()
    expect(readDesign(store).frames['new-frame']).toMatchObject({ pageId: 'new-page' })
  })
})
