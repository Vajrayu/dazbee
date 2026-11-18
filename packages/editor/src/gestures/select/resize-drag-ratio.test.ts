// A resize of a layer whose ratio is locked: the handles keep its shape, with its linked copies
// whose ratio is locked too, and an edge fixes both its sides.
import { describe, expect, it } from 'vitest'

import { type Frame, pageFrames } from '../../canvas/frames.ts'
import { harness } from './test-transform-drag.ts'

describe('editorResizeDrag', () => {
  describe('pressHandle and resize, with Lock ratio', () => {
    it('keeps the shape of the one layer selected whose ratio is locked, from a corner and an edge, without Shift', () => {
      const { drag, session, selection, frame, boxOf, pressSelection } = harness()
      session.run('node.update', { ids: ['a'], patch: { lockRatio: true } })
      selection.select(['a'], frame.id)
      const corner = pressSelection({ x: 200, y: 200 })
      drag.drag(corner, { x: 300, y: 220 }, false, false, false)
      expect(boxOf('a')).toMatchObject({ width: 200, height: 200 })
      drag.release(corner)
      const edge = pressSelection({ x: 300, y: 200 })
      drag.drag(edge, { x: 400, y: 200 }, false, false, false)
      expect(boxOf('a')).toMatchObject({ width: 300, height: 300 })
      drag.release(edge)
    })

    it('keeps the shape of a layer whose ratio is locked with its selected linked copy, when the copy has it locked too', () => {
      const { drag, session, selection, frame, boxOf, pressSelection } = harness()
      const wide = pageFrames(session.design(), 'p1').frames[1] as Frame
      session.run('node.update', { ids: ['a', 'wide-a'], patch: { lockRatio: true } })
      selection.selectAcross([
        { id: 'a', frameId: frame.id },
        { id: 'wide-a', frameId: wide.id },
      ])
      const edge = pressSelection({ x: 200, y: 150 })
      drag.drag(edge, { x: 250, y: 150 }, false, false, false)
      expect([boxOf('a'), boxOf('wide-a')]).toMatchObject([
        { width: 150, height: 150 },
        { width: 150, height: 150 },
      ])
      drag.release(edge)
      // A copy whose ratio is free resizes both freely.
      session.run('node.update', { ids: ['wide-a'], patch: { lockRatio: undefined } })
      const again = pressSelection({ x: 250, y: 175 })
      drag.drag(again, { x: 300, y: 175 }, false, false, false)
      expect(boxOf('a')).toMatchObject({ width: 200, height: 150 })
    })

    it('fixes both sides of a text whose ratio is locked as an edge resizes it, so its height stays where the drag put it', () => {
      const { drag, session, selection, frame, boxOf, pressSelection } = harness()
      session.run('node.update', { ids: ['words'], patch: { lockRatio: true, boxMode: 'autoHeight' } })
      selection.select(['words'], frame.id)
      const { x, y, width, height } = boxOf('words')
      const edge = pressSelection({ x: x + width, y: y + height / 2 })
      expect(edge).toMatchObject({ kind: 'resize', handle: 'e' })
      drag.drag(edge, { x: x + width * 1.5, y: y + height / 2 }, false, false, false)
      drag.release(edge)
      expect(session.design().nodes.words?.props).toMatchObject({
        boxMode: 'fixed',
        width: width * 1.5,
        height: height * 1.5,
      })
    })

    it('resizes freely layers whose ratio is locked once several are selected, as FigCraft does', () => {
      const { drag, session, selection, frame, boxOf, pressSelection } = harness()
      session.run('node.update', { ids: ['a'], patch: { lockRatio: true } })
      selection.select(['a', 'b'], frame.id)
      const edge = pressSelection({ x: 500, y: 150 })
      expect(edge).toMatchObject({ kind: 'resize', handle: 'e' })
      drag.drag(edge, { x: 700, y: 150 }, false, false, false)
      expect(boxOf('a')).toMatchObject({ width: 150, height: 100 })
      drag.release(edge)
    })
  })
})
