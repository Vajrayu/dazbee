import { describe, expect, it } from 'vitest'

import type { Design, DesignInput } from '@dazbee/schema'

import { type Frame, pageFrames } from '../canvas/frames.ts'
import { editorSelection, idsOf, pairsIn } from '../selection.ts'
import { withFaulty } from '../test-faults.ts'
import { copiedIds, editorDuplicate, originalLinks } from './duplicate.ts'
import { hug } from './hug.ts'
import { sessionOf, testBoxes } from './test-boxes.ts'
import { centreOf } from './transform.ts'

/** A deep copy of a design, which the session's live view of it is not. */
const deepCopy = (design: Design) => JSON.parse(JSON.stringify(design)) as Design
const square = (parentId: string, index: string, x: number, y: number) => ({
  type: 'graphic' as const,
  parentId,
  link: `${parentId}-${index}`,
  index,
  name: 'Square',
  props: { x, y, width: 50, height: 50, shape: { kind: 'rect' as const } },
})
const group = (
  parentId: string,
  index: string,
  box: { x: number; y: number; width: number; height: number },
  rotation = 0,
) => ({
  type: 'group' as const,
  parentId,
  link: `${parentId}-${index}`,
  index,
  name: 'Group',
  props: { ...box, rotation },
})
/**
 * A square frame holding a square, a group fitted to one square, a group turned a quarter about
 * one square, a row laid out by auto layout holding two squares, and another square; a wide frame
 * holding one square.
 */
const DESIGN: DesignInput = {
  meta: { designId: 'd', name: 'D' },
  pages: { p1: { name: 'One', order: 'a0' } },
  frames: {
    sq: { pageId: 'p1', name: 'Square', width: 1080, height: 1080, x: 0, y: 0, order: 'a0' },
    wide: { pageId: 'p1', name: 'Wide', width: 1200, height: 628, x: 1280, y: 0, order: 'a1' },
  },
  nodes: {
    a: square('sq', 'a0', 100, 100),
    held: group('sq', 'a1', { x: 300, y: 100, width: 50, height: 50 }),
    inHeld: square('held', 'a0', 300, 100),
    turned: group('sq', 'a2', { x: 500, y: 100, width: 50, height: 50 }, 90),
    inTurned: square('turned', 'a0', 500, 100),
    row: {
      type: 'box',
      parentId: 'sq',
      link: 'row',
      index: 'a3',
      name: 'Row',
      props: { x: 100, y: 500, width: 400, height: 100, layout: { direction: 'row', gap: 10 } },
    },
    first: square('row', 'a0', 0, 0),
    second: square('row', 'a1', 0, 0),
    other: square('sq', 'a4', 700, 700),
    w: square('wide', 'a0', 100, 100),
  },
}

/** The duplicate over a real session, selection and boxes, with readers of where layers are. */
function harness() {
  const session = sessionOf(DESIGN)
  const frames = pageFrames(session.design(), 'p1').frames
  const [frame, wide] = frames as [Frame, Frame]
  const selection = editorSelection({ drawn: () => session.design(), frames: () => frames, changed: () => {} })
  const boxes = testBoxes(session, selection, frames)
  const duplicate = editorDuplicate({ session, selection, boxes, hug: (ids) => hug(session, ids) })
  /** Selects layers in the square frame, and tells the listeners as a redraw does. */
  const select = (...ids: string[]) => {
    selection.select(ids, frame.id)
    selection.tellListeners()
  }
  /** Duplicates and tells the selection's listeners as the redraw after it does; returns the copies. */
  const run = () => {
    duplicate.duplicate()
    selection.tellListeners()
    return idsOf(selection.current())
  }
  /** Undoes or redoes, then drops the selected layers that are gone and tells the listeners, as the redraw after it does. */
  const step = (way: 'undo' | 'redo') => {
    if (way === 'undo') session.undo()
    else session.redo()
    selection.keep()
    selection.tellListeners()
  }
  /** A layer's stored x and y. */
  const at = (id: string) => {
    const { x, y } = session.design().nodes[id]?.props ?? { x: NaN, y: NaN }
    return { x, y }
  }
  /** Where a layer's centre is drawn in the square frame. */
  const drawnCentre = (id: string) => {
    const box = boxes.drawnBoxOf(frame, id)
    if (!box) throw new Error(`${id} is not drawn`)
    const { x, y } = centreOf(box)
    return { x: Math.round(x), y: Math.round(y) }
  }
  const order = (parentId: string) =>
    Object.entries(session.design().nodes)
      .filter(([, node]) => node.parentId === parentId)
      .sort(([, l], [, r]) => (l.index < r.index ? -1 : 1))
      .map(([id]) => id)
  return { session, selection, boxes, duplicate, frame, wide, select, run, step, at, drawnCentre, order }
}

describe('editorDuplicate', () => {
  describe('duplicate', () => {
    it('places a copy 20 right and down of its original, right above it, and selects it, as one undo step named duplicate', () => {
      const { session, select, run, at, order } = harness()
      const before = deepCopy(session.design())
      select('a')
      const [copy = ''] = run()
      expect(at(copy)).toEqual({ x: 120, y: 120 })
      expect(at('a')).toEqual({ x: 100, y: 100 })
      expect(order('sq').slice(0, 2)).toEqual(['a', copy])
      expect(session.undoName()).toBe('duplicate')
      session.undo()
      expect(session.design()).toEqual(before)
    })

    it('moves what a copied group holds with it', () => {
      const { select, run, at, session } = harness()
      select('held')
      const [copy = ''] = run()
      const [inner = ''] = Object.keys(session.design().nodes).filter(
        (id) => session.design().nodes[id]?.parentId === copy,
      )
      expect([at(copy), at(inner)]).toEqual([
        { x: 320, y: 120 },
        { x: 320, y: 120 },
      ])
    })

    it('grows a group that fits its layers around a copy made inside it', () => {
      const { select, run, at, session } = harness()
      select('inHeld')
      const [copy = ''] = run()
      expect(at(copy)).toEqual({ x: 320, y: 120 })
      expect(session.design().nodes.held?.props).toMatchObject({ x: 300, y: 100, width: 70, height: 70 })
    })

    it('places a copy inside a turned group 20 right and down of its original as drawn on the page', () => {
      const { select, run, drawnCentre } = harness()
      select('inTurned')
      const [copy = ''] = run()
      const was = drawnCentre('inTurned')
      expect(drawnCentre(copy)).toEqual({ x: was.x + 20, y: was.y + 20 })
    })

    it('copies a layer in an auto layout box right after itself with no offset, where the flow places it', () => {
      const { select, run, at, order } = harness()
      select('first')
      const [copy = ''] = run()
      expect(order('row')).toEqual(['first', copy, 'second'])
      expect(at(copy)).toEqual(at('first'))
    })

    it('copies several layers across two frames, each in its own frame, selecting every copy', () => {
      const { selection, frame, wide, run, at } = harness()
      selection.selectAcross([...pairsIn(frame.id, ['a', 'other']), ...pairsIn(wide.id, ['w'])])
      const copies = run()
      expect(selection.current()?.map((layer) => layer.frameId)).toEqual([frame.id, frame.id, wide.id])
      expect(copies.map(at)).toEqual([
        { x: 120, y: 120 },
        { x: 720, y: 720 },
        { x: 120, y: 120 },
      ])
    })

    it('does nothing with nothing selected', () => {
      const { session, duplicate } = harness()
      const before = deepCopy(session.design())
      duplicate.duplicate()
      expect(session.design()).toEqual(before)
      expect(session.canUndo()).toBe(false)
    })

    it('again, while the copies are the whole selection, places the next ones as far from them as they are from their sources', () => {
      const { session, select, run, at } = harness()
      select('a')
      run()
      const [second = ''] = run()
      expect(at(second)).toEqual({ x: 140, y: 140 })
      session.run('node.update', { ids: [second], patch: { x: 150, y: 130 } })
      const [third = ''] = run()
      expect(at(third)).toEqual({ x: 180, y: 140 })
    })

    it('again, measures the step at that moment: a copy moved since sets the next one beside it as far again', () => {
      const { session, select, run, at } = harness()
      select('a')
      const [copy = ''] = run()
      session.run('node.update', { ids: [copy], patch: { x: 150, y: 110 } })
      const [next = ''] = run()
      expect(at(next)).toEqual({ x: 200, y: 120 })
    })

    it('forgets the last duplicate once another selection is made, even when the copies are selected again', () => {
      const { session, select, run, at } = harness()
      select('a')
      const [copy = ''] = run()
      session.run('node.update', { ids: [copy], patch: { x: 150, y: 110 } })
      select('other')
      select(copy)
      const [next = ''] = run()
      expect(at(next)).toEqual({ x: 170, y: 130 })
    })

    it('again, after an undo that leaves the copies selected, places the next ones as far from them as they now are from their sources', () => {
      const { session, select, run, step, at } = harness()
      select('a')
      const [copy = ''] = run()
      session.run('node.update', { ids: [copy], patch: { x: 130 } })
      session.run('node.update', { ids: [copy], patch: { x: 140 } })
      step('undo')
      expect(at(copy)).toEqual({ x: 130, y: 120 })
      const [next = ''] = run()
      expect(at(next)).toEqual({ x: 160, y: 140 })
    })

    it('keeps the selection after a fault puts its step back, so the next one copies it', () => {
      const { session, selection, select, run, at } = harness()
      select('inHeld')
      withFaulty('node.hug', () => expect(run).toThrow(/boom/))
      selection.keep()
      selection.tellListeners()
      expect(idsOf(selection.current())).toEqual(['inHeld'])
      expect(session.canUndo()).toBe(false)
      const [copy = ''] = run()
      expect(at(copy)).toEqual({ x: 320, y: 120 })
    })

    it('forgets the last duplicate once an undo takes its copies away, which lets the selection go', () => {
      const { session, selection, select, run, step, at } = harness()
      select('a')
      const [copy = ''] = run()
      session.run('node.update', { ids: [copy], patch: { x: 150, y: 110 } })
      step('undo')
      step('undo')
      expect(selection.current()).toBeNull()
      step('redo')
      step('redo')
      select(copy)
      const [next = ''] = run()
      expect(at(next)).toEqual({ x: 170, y: 130 })
    })
  })

  describe('copyInPlace', () => {
    it('copies layers of each frame where they are, each right above its original, in the undo step open, and selects the copies', () => {
      const { session, selection, frame, wide, duplicate, at, order } = harness()
      const before = deepCopy(session.design())
      const made = session.gesture('move', () =>
        duplicate.copyInPlace([
          { frame, ids: ['a', 'inHeld'] },
          { frame: wide, ids: ['w'] },
        ]),
      )
      const [[copy = '', inner = ''] = [], [wideCopy = ''] = []] = made.map((copies) => [...copies.values()])
      expect(made.map((copies) => [...copies.keys()])).toEqual([['a', 'inHeld'], ['w']])
      expect([at(copy), at(inner), at(wideCopy)]).toEqual([at('a'), at('inHeld'), at('w')])
      expect(order('sq').slice(0, 2)).toEqual(['a', copy])
      expect(session.design().nodes[inner]?.parentId).toBe('held')
      expect(selection.current()).toEqual([...pairsIn(frame.id, [copy, inner]), ...pairsIn(wide.id, [wideCopy])])
      expect(session.undoName()).toBe('move')
      session.undo()
      expect(session.design()).toEqual(before)
    })

    it('leaves out layers no longer in the design, pairing each copy with its own source; with none made it selects nothing new and returns no copies', () => {
      const { session, selection, frame, duplicate, select } = harness()
      select('a')
      const [made = new Map<string, string>()] = duplicate.copyInPlace([{ frame, ids: ['gone', 'a'] }])
      expect([...made.keys()]).toEqual(['a'])
      select('other')
      const none = duplicate.copyInPlace([{ frame, ids: ['gone'] }])
      expect(none).toEqual([new Map()])
      expect(idsOf(selection.current())).toEqual(['other'])
      expect(Object.keys(session.design().nodes)).toHaveLength(Object.keys(DESIGN.nodes).length + 1)
    })

    it('keeps the copies as the last duplicate: Duplicate then places the next ones as far from them as they are from their sources', () => {
      const { session, frame, duplicate, selection, run, at } = harness()
      const [copy = ''] = [...(duplicate.copyInPlace([{ frame, ids: ['a'] }])[0]?.values() ?? [])]
      selection.tellListeners()
      session.run('node.update', { ids: [copy], patch: { y: 250 } })
      const [next = ''] = run()
      expect(at(next)).toEqual({ x: 100, y: 400 })
    })

    it('measures no step from copies that went into another frame than their sources: Duplicate then steps 20 right and down', () => {
      const { session, frame, duplicate, selection, run } = harness()
      const [copy = ''] = [...(duplicate.copyInPlace([{ frame, ids: ['a'] }])[0]?.values() ?? [])]
      session.run('node.move', { id: copy, parentId: 'wide' })
      selection.keep()
      selection.tellListeners()
      const was = session.design().nodes[copy]?.props
      const [next = ''] = run()
      expect(session.design().nodes[next]?.parentId).toBe('wide')
      expect(session.design().nodes[next]?.props).toMatchObject({ x: (was?.x ?? 0) + 20, y: (was?.y ?? 0) + 20 })
    })
  })
})

describe('copiedIds', () => {
  it('pairs each layer of copies, and of what they hold, with the layer it copies', () => {
    const { session } = harness()
    const [held = '', a = ''] = session.run('node.duplicate', { ids: ['held', 'a'] })
    const design = session.design()
    const [inHeld] = Object.entries(design.nodes).find(([, node]) => node.parentId === held) ?? []
    expect(
      copiedIds(
        design,
        new Map([
          ['held', held],
          ['a', a],
        ]),
      ),
    ).toEqual(
      new Map([
        ['held', held],
        ['inHeld', inHeld],
        ['a', a],
      ]),
    )
  })
})

describe('originalLinks', () => {
  it('gives each layer of copies, and of what they hold, the link id of the layer it copies', () => {
    const { session } = harness()
    const [held = '', a = ''] = session.run('node.duplicate', { ids: ['held', 'a'] })
    const design = session.design()
    const [inHeld] = Object.entries(design.nodes).find(([, node]) => node.parentId === held) ?? []
    expect(
      originalLinks(
        design,
        new Map([
          ['held', held],
          ['a', a],
        ]),
      ),
    ).toEqual({
      [held]: 'sq-a1',
      [inHeld ?? '']: 'held-a0',
      [a]: 'sq-a0',
    })
  })
})
