// The constraint lines the overlay draws while the page asks for them: for each selected layer, a
// dashed line from each side it keeps to, to its parent's side, a short bar through its middle for
// each axis kept to the centre, none for scale, along a turned parent's sides.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Constraints, DesignInput } from '@dazbee/schema'

import { sessionOf, testBoxes } from '../layers/test-boxes.ts'
import { pairsIn } from '../selection.ts'
import { pageFrames } from './frames.ts'
import { type Fake, fake, harness } from './test-overlay.ts'

/** A rectangle 50 × 40 at 100, 200 in its parent, with these constraints, as one value of each axis. */
const rect = (
  parentId: string,
  index: string,
  constraints?: [Constraints['horizontal'], Constraints['vertical']],
  at = { x: 100, y: 200 },
) => ({
  type: 'graphic' as const,
  parentId,
  link: `${parentId}-${index}`,
  index,
  name: 'Rect',
  props: {
    ...at,
    width: 50,
    height: 40,
    shape: { kind: 'rect' as const },
    ...(constraints && { constraints: { horizontal: constraints[0], vertical: constraints[1] } }),
  },
})
/**
 * A frame 1000 × 800 holding a layer of each pair of constraints, all at the same box; a box at
 * 400, 400, 200 × 100, turned 90°, holding a layer set left and top; a group holding one; and a row
 * laid out holding one its flow places.
 */
const DESIGN: DesignInput = {
  meta: { designId: 'd', name: 'D' },
  pages: { p1: { name: 'One', order: 'a0' } },
  frames: { sq: { pageId: 'p1', name: 'Square', width: 1000, height: 800, x: 0, y: 0, order: 'a0' } },
  nodes: {
    none: rect('sq', 'a0'),
    rightBottom: rect('sq', 'a1', ['right', 'bottom']),
    both: rect('sq', 'a2', ['leftRight', 'topBottom']),
    centred: rect('sq', 'a3', ['center', 'center']),
    centreTop: rect('sq', 'a4', ['center', 'top']),
    scaled: rect('sq', 'a5', ['scale', 'scale']),
    turned: {
      type: 'box',
      parentId: 'sq',
      link: 'turned',
      index: 'a6',
      name: 'Turned',
      props: { x: 400, y: 400, width: 200, height: 100, rotation: 90 },
    },
    inTurned: rect('turned', 'a0', undefined, { x: 420, y: 430 }),
    group: {
      type: 'group',
      parentId: 'sq',
      link: 'group',
      index: 'a7',
      name: 'Group',
      props: { x: 100, y: 600, width: 50, height: 40 },
    },
    inGroup: rect('group', 'a0', undefined, { x: 100, y: 600 }),
    row: {
      type: 'box',
      parentId: 'sq',
      link: 'row',
      index: 'a8',
      name: 'Row',
      props: { x: 600, y: 600, width: 300, height: 100, layout: { direction: 'row' } },
    },
    inRow: rect('row', 'a0'),
  },
}

/**
 * The overlay at zoom `zoom` with the page's origin at the stage's top left, over a real session of
 * DESIGN, these layers of the square selected and the constraint lines asked for or not.
 */
function drawWith(ids: string[], { asked = true, zoom = 1 } = {}) {
  const session = sessionOf(DESIGN)
  const frames = pageFrames(session.design(), 'p1').frames
  const current = () => pairsIn('sq', ids)
  const boxes = testBoxes(session, { current, entered: () => null }, frames)
  const shown = harness({ x: 0, y: 0, zoom }, (deps) => ({
    ...deps,
    view: { ...deps.view, design: session.design, frameOf: (id) => frames.find((f) => f.id === id) },
    selection: { ...deps.selection, current, constraintsShown: () => asked },
    boxes: { ...deps.boxes, boxIn: boxes.boxIn, containersOf: boxes.containersOf },
  }))
  shown.overlay.draw()
  return shown
}

/** Each line drawn: what it is, for which layer, and where it is placed on the stage, turned or not. */
const placed = (parts: Fake[]) => parts.map((p) => ({ ...p.dataset, ...p.style }))

beforeEach(() => {
  vi.stubGlobal('document', { createElement: () => fake(), createElementNS: (_ns: string, name: string) => fake(name) })
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('editorOverlay', () => {
  describe('draw, while the constraint lines are asked for', () => {
    it('draws them right after the selection with its size, before what the gestures show', () => {
      const { drawn } = drawWith(['none'])
      const at = drawn().indexOf('selection-size')
      expect(drawn().slice(at, at + 4)).toEqual(['selection-size', 'constraint-line', 'constraint-line', 'svg'])
    })

    it('draws, for a layer with none, a line from its left side to the frame’s and from its top to the frame’s', () => {
      const { parts } = drawWith(['none'])
      expect(placed(parts('constraint-line'))).toEqual([
        { layer: 'none', side: 'left', run: 'across', left: '0px', top: '220px', width: '100px', height: '0px' },
        { layer: 'none', side: 'top', run: 'down', left: '125px', top: '0px', width: '0px', height: '200px' },
      ])
    })

    it('draws, for right and bottom, a line from its right side and its bottom to the frame’s', () => {
      const { parts } = drawWith(['rightBottom'])
      expect(placed(parts('constraint-line'))).toEqual([
        {
          layer: 'rightBottom',
          side: 'right',
          run: 'across',
          left: '150px',
          top: '220px',
          width: '850px',
          height: '0px',
        },
        {
          layer: 'rightBottom',
          side: 'bottom',
          run: 'down',
          left: '125px',
          top: '240px',
          width: '0px',
          height: '560px',
        },
      ])
    })

    it('draws, for left and right, top and bottom, a line from each of its four sides', () => {
      const { parts } = drawWith(['both'])
      expect(parts('constraint-line').map((p) => p.dataset.side)).toEqual(['left', 'right', 'top', 'bottom'])
    })

    it('draws, for centre both ways, a cross of two short bars through its middle, 8 screen pixels each way, and no line', () => {
      for (const zoom of [1, 2]) {
        const { parts } = drawWith(['centred'], { zoom })
        expect(parts('constraint-line'), `zoom ${zoom}`).toEqual([])
        expect(placed(parts('constraint-bar')), `zoom ${zoom}`).toEqual([
          {
            layer: 'centred',
            run: 'across',
            left: `${125 * zoom - 8}px`,
            top: `${220 * zoom}px`,
            width: '16px',
            height: '0px',
          },
          {
            layer: 'centred',
            run: 'down',
            left: `${125 * zoom}px`,
            top: `${220 * zoom - 8}px`,
            width: '0px',
            height: '16px',
          },
        ])
      }
    })

    it('draws, for centre across and top, the bar across and the line from its top', () => {
      const { parts } = drawWith(['centreTop'])
      expect(parts('constraint-bar').map((p) => p.dataset.run)).toEqual(['across'])
      expect(parts('constraint-line').map((p) => p.dataset.side)).toEqual(['top'])
    })

    it('draws nothing for scale', () => {
      const { parts } = drawWith(['scaled'])
      expect([...parts('constraint-line'), ...parts('constraint-bar')]).toEqual([])
    })

    it('draws the lines of each selected layer, in the order they were picked', () => {
      const { parts } = drawWith(['rightBottom', 'none'])
      expect(parts('constraint-line').map((p) => `${p.dataset.layer} ${p.dataset.side}`)).toEqual([
        'rightBottom right',
        'rightBottom bottom',
        'none left',
        'none top',
      ])
    })

    it('draws the lines of a layer in a turned box along the box’s sides, turned with it', () => {
      const { parts } = drawWith(['inTurned'])
      // In the box's own space the layer's left side is 20 from the box's, its top 30 from the box's;
      // the box's turn about its middle, 500, 450, takes each line there.
      expect(placed(parts('constraint-line'))).toEqual([
        {
          layer: 'inTurned',
          side: 'left',
          run: 'across',
          left: '490px',
          top: '360px',
          width: '20px',
          height: '0px',
          transform: 'rotate(90deg)',
        },
        {
          layer: 'inTurned',
          side: 'top',
          run: 'down',
          left: '535px',
          top: '380px',
          width: '0px',
          height: '30px',
          transform: 'rotate(90deg)',
        },
      ])
    })
  })

  describe('draw, while the rule reads no constraints or none are asked for', () => {
    it('draws none while the page asks for none', () => {
      const { drawn } = drawWith(['none', 'rightBottom'], { asked: false })
      expect(drawn()).not.toContain('constraint-line')
    })

    it('draws none for a layer in a group, one its flow places, or a selection holding one', () => {
      for (const ids of [['inGroup'], ['inRow'], ['none', 'inRow']]) {
        const { drawn } = drawWith(ids)
        expect(drawn(), ids.join()).not.toContain('constraint-line')
      }
    })
  })
})
