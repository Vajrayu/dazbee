import { describe, expect, it } from 'vitest'

import type { Frame } from '../canvas/frames.ts'
import { pageFrames } from '../canvas/frames.ts'
import { editorSelection } from '../selection.ts'
import { FLOW } from '../test-actions.ts'
import { deleteLayers, setHidden } from './delete-hide.ts'
import { sessionOf, testBoxes } from './test-boxes.ts'

/** The flow design on a real session, with where a layer of the square is drawn. */
function harness() {
  const session = sessionOf(FLOW)
  const frames = pageFrames(session.design(), 'p1').frames
  const selection = editorSelection({ drawn: () => session.design(), frames: () => frames, changed: () => {} })
  const boxes = testBoxes(session, selection, frames)
  const drawnOf = (id: string) => boxes.drawnRect(frames[0] as Frame, id)
  return { session, boxes, drawnOf }
}

describe('deleteLayers', () => {
  it('keeps a box that fits its content at the size it is drawn when the delete empties its flow', () => {
    const { session, boxes, drawnOf } = harness()
    const was = drawnOf('hugging')
    expect(was).toMatchObject({ width: 120, height: 120 })
    session.gesture(() => deleteLayers(session, boxes, ['inHug']))
    expect(session.design().nodes.inHug).toBeUndefined()
    expect(drawnOf('hugging')).toEqual(was)
    session.undo()
    expect(session.design().nodes.hugging?.props).toMatchObject({ width: 10, height: 10 })
    session.redo()
    expect(drawnOf('hugging')).toEqual(was)
  })
})

describe('setHidden', () => {
  it('keeps a box that fits its content at the size it is drawn when hiding empties its flow, and fits it again shown', () => {
    const { session, boxes, drawnOf } = harness()
    const was = drawnOf('hugging')
    setHidden(session, boxes, ['inHug'], true)
    expect(drawnOf('hugging')).toEqual(was)
    session.run('node.update', { ids: ['inHug'], patch: { width: 100 } })
    setHidden(session, boxes, ['inHug'], false)
    expect(drawnOf('hugging')).toMatchObject({ width: 160, height: 120 })
  })

  it('names hiding hide and showing show, each one step', () => {
    const { session, boxes } = harness()
    setHidden(session, boxes, ['inHug'], true)
    expect(session.undoName()).toBe('hide')
    setHidden(session, boxes, ['inHug'], false)
    expect(session.undoName()).toBe('show')
  })
})
