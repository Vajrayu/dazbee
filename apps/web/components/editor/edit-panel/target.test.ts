// The selection as the edit panel reads it, held against the editor: the panel offers several layers
// Combine when they are shapes (`kindOf`), and the editor's `actionReady` must find Combine ready
// for exactly those selections, opened in Node with nothing stubbed. Then Position's Constraints
// part: where it shows, what each axis reads, and what a pick writes.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Editor } from '@dazbee/editor'
import { type TestEditor, testEditor } from '@dazbee/editor/test-editor'
import { frameDesign, type Seeded } from '@dazbee/editor/test-matrix'
import { type Design, type DesignInput, parseDesign } from '@dazbee/schema'

import { constraintPatch, constraintsShown, kindOf, type Target } from './target.ts'

/** A photo one pixel square, as a PNG. */
const PIXEL = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
)
const BLUE = { type: 'solid' as const, color: '#2F6BFFFF' }
const PHOTO = { type: 'image' as const, assetId: 'photo-1' }
const shape = (index: string, x: number, fills: unknown[] = [BLUE], parentId = 'sq'): Seeded =>
  ({
    type: 'graphic',
    parentId,
    index,
    name: 'Shape',
    props: { x, y: 100, width: 80, height: 80, shape: { kind: 'rect' }, fills },
  }) as Seeded
const boolean = (index: string, x: number): Seeded => ({
  type: 'boolean',
  parentId: 'sq',
  index,
  name: 'Union',
  props: { x, y: 300, width: 180, height: 80, op: 'union' },
})
/**
 * Two plain shapes, two shapes filled with the same photo, a text, a box and two booleans of two
 * shapes each, side by side in one frame; and a frame linked to none holding one plain shape.
 */
const ONE_FRAME = frameDesign({
  name: 'Combine',
  nodes: {
    a: shape('a0', 100),
    b: shape('a1', 200),
    p1: shape('a2', 300, [BLUE, PHOTO]),
    p2: shape('a3', 400, [BLUE, PHOTO]),
    t: {
      type: 'text',
      parentId: 'sq',
      index: 'a4',
      name: 'Words',
      props: {
        x: 500,
        y: 100,
        width: 200,
        height: 60,
        text: 'Sale',
        boxMode: 'fixed',
        style: { fontFamily: 'Noto Sans', fontSize: 40, color: '#000000FF' },
      },
    },
    bx: { type: 'box', parentId: 'sq', index: 'a5', name: 'Box', props: { x: 700, y: 100, width: 100, height: 100 } },
    u1: boolean('a6', 100),
    u1a: { ...shape('a0', 100, [BLUE], 'u1'), props: { ...shape('a0', 100).props, y: 300 } } as Seeded,
    u1b: { ...shape('a1', 200, [BLUE], 'u1'), props: { ...shape('a1', 200).props, y: 300 } } as Seeded,
    u2: boolean('a7', 400),
    u2a: { ...shape('a0', 400, [BLUE], 'u2'), props: { ...shape('a0', 400).props, y: 300 } } as Seeded,
    u2b: { ...shape('a1', 500, [BLUE], 'u2'), props: { ...shape('a1', 500).props, y: 300 } } as Seeded,
  },
})
const DESIGN = {
  ...ONE_FRAME,
  frames: {
    ...ONE_FRAME.frames,
    apart: { pageId: 'p1', name: 'Apart', width: 500, height: 500, x: 0, y: 1300, order: 'a1' },
  },
  nodes: { ...ONE_FRAME.nodes, c: { ...shape('a0', 100, [BLUE], 'apart'), link: 'c' } },
} as DesignInput

/** The selection as the edit panel reads it, each layer with its own values. */
function targetOf(ed: TestEditor, ids: string[]): Target {
  const design = ed.core.design()
  const props = ids.map((id) => ed.core.drawnPropsOf(id))
  return {
    editor: ed.core as unknown as Editor,
    ids,
    props: props as Target['props'],
    types: ids.map((id) => design.nodes[id]?.type ?? ''),
    names: ids.map((id) => design.nodes[id]?.name ?? ''),
  }
}

/**
 * A frame holding a layer set right and bottom, one with no constraints, one set left and right and
 * top, a Free box holding one, a row laid out holding one its flow places and one kept where it is
 * put, a group holding one and a boolean of two shapes.
 */
const HELD = (() => {
  const rect = (parentId: string, index: string, extra: Record<string, unknown> = {}): Seeded =>
    ({
      type: 'graphic',
      parentId,
      index,
      name: 'Rect',
      props: { x: 100, y: 100, width: 50, height: 50, shape: { kind: 'rect' }, ...extra },
    }) as Seeded
  const parsed = parseDesign(
    frameDesign({
      name: 'Constraints',
      nodes: {
        corner: rect('sq', 'a0', { constraints: { horizontal: 'right', vertical: 'bottom' } }),
        plain: rect('sq', 'a1'),
        wide: rect('sq', 'a2', { constraints: { horizontal: 'leftRight', vertical: 'top' } }),
        free: {
          type: 'box',
          parentId: 'sq',
          index: 'a3',
          name: 'Free',
          props: { x: 0, y: 0, width: 500, height: 500 },
        },
        inFree: rect('free', 'a0'),
        row: {
          type: 'box',
          parentId: 'sq',
          index: 'a4',
          name: 'Row',
          props: { x: 0, y: 600, width: 500, height: 200, layout: { direction: 'row' } },
        },
        placed: rect('row', 'a0'),
        kept: rect('row', 'a1', { absolute: true }),
        group: {
          type: 'group',
          parentId: 'sq',
          index: 'a5',
          name: 'Group',
          props: { x: 100, y: 100, width: 50, height: 50 },
        },
        inGroup: rect('group', 'a0'),
        union: {
          type: 'boolean',
          parentId: 'sq',
          index: 'a6',
          name: 'Union',
          props: { x: 100, y: 100, width: 50, height: 50, op: 'union' },
        },
        inUnion: rect('union', 'a0'),
      },
    }),
  )
  if (!parsed.success) throw new Error(parsed.errors.join('\n'))
  return parsed.design
})()

/** The selection of these layers of a design, each with its own stored values. */
function heldTarget(design: Design, ids: string[]): Target {
  return {
    editor: null as unknown as Editor,
    ids,
    props: ids.map((id) => design.nodes[id]?.props ?? {}) as Target['props'],
    types: ids.map((id) => design.nodes[id]?.type ?? ''),
    names: ids.map((id) => design.nodes[id]?.name ?? ''),
  }
}

describe('kindOf', () => {
  let ed: TestEditor
  beforeAll(async () => {
    ed = await testEditor(DESIGN, { sources: { assetBytes: () => Promise.resolve(PIXEL) } })
  })
  afterAll(() => ed.end())

  it('makes several layers shapes, which the Shape tab offers Combine, exactly when the editor finds Combine ready', () => {
    const cases: [string, string[], boolean][] = [
      ['two shapes', ['a', 'b'], true],
      ['two shapes with the same photo', ['p1', 'p2'], false],
      ['a photo and a plain shape', ['p1', 'a'], true],
      ['a shape and a text', ['a', 't'], false],
      ['a shape and a box', ['a', 'bx'], false],
      ['one shape', ['a'], false],
      ['two booleans', ['u1', 'u2'], true],
      // Combine runs in each frame holding two or more of them, leaving the other frame's one be.
      ['two shapes in one frame and one in another', ['a', 'b', 'c'], true],
    ]
    const found = cases.map(([name, ids]) => {
      ed.core.select(ids)
      const bar = kindOf(targetOf(ed, ids)) === 'shape' && ids.length >= 2
      return [name, bar, ed.core.actionReady('booleanUnion')]
    })
    expect(found).toEqual(cases.map(([name, , combines]) => [name, combines, combines]))
  })
})

describe('constraintsShown', () => {
  it('reads each axis of one layer, left and top for a layer with none', () => {
    expect(constraintsShown(heldTarget(HELD, ['corner']), HELD)).toEqual({ horizontal: 'right', vertical: 'bottom' })
    expect(constraintsShown(heldTarget(HELD, ['plain']), HELD)).toEqual({ horizontal: 'left', vertical: 'top' })
  })

  it('reads an axis the layers share as its value, and one they differ on as mixed', () => {
    expect(constraintsShown(heldTarget(HELD, ['plain', 'wide']), HELD)).toEqual({
      horizontal: 'mixed',
      vertical: 'top',
    })
    expect(constraintsShown(heldTarget(HELD, ['corner', 'wide']), HELD)).toEqual({
      horizontal: 'mixed',
      vertical: 'mixed',
    })
  })

  it('shows for layers in a frame, a Free box and kept where they are put in a laid-out box', () => {
    expect(constraintsShown(heldTarget(HELD, ['inFree', 'kept', 'plain']), HELD)).toEqual({
      horizontal: 'left',
      vertical: 'top',
    })
  })

  it('is null for a layer its flow places, one in a group or a boolean, and any selection holding one', () => {
    for (const ids of [['placed'], ['inGroup'], ['inUnion'], ['plain', 'placed']])
      expect(constraintsShown(heldTarget(HELD, ids), HELD), ids.join()).toBeNull()
  })

  it('shows for a layer its flow placed once it is kept where it is put', () => {
    const freed: Design = structuredClone(HELD)
    const placed = freed.nodes.placed
    if (!placed) throw new Error('no placed layer')
    placed.props.absolute = true
    expect(constraintsShown(heldTarget(freed, ['placed']), freed)).toEqual({ horizontal: 'left', vertical: 'top' })
  })
})

describe('constraintPatch', () => {
  it('sets one axis, keeping the layer’s own other axis', () => {
    expect(
      constraintPatch({ constraints: { horizontal: 'right', vertical: 'bottom' } }, { horizontal: 'center' }),
    ).toEqual({
      constraints: { horizontal: 'center', vertical: 'bottom' },
    })
    expect(
      constraintPatch({ constraints: { horizontal: 'right', vertical: 'bottom' } }, { vertical: 'scale' }),
    ).toEqual({
      constraints: { horizontal: 'right', vertical: 'scale' },
    })
  })

  it('gives a layer with none the whole pair, its other axis left or top, left and top included', () => {
    expect(constraintPatch({}, { vertical: 'bottom' })).toEqual({
      constraints: { horizontal: 'left', vertical: 'bottom' },
    })
    expect(constraintPatch({}, { horizontal: 'left' })).toEqual({
      constraints: { horizontal: 'left', vertical: 'top' },
    })
  })
})
