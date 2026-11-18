// Wrap and the room between lines as the layout section sets them, held against the editor opened in
// Node: a box that fits its length along the flow is fixed at its drawn size and wraps at once.
import { afterEach, describe, expect, it } from 'vitest'

import type { Editor } from '@dazbee/editor'
import { type TestEditor, testEditor } from '@dazbee/editor/test-editor'
import { frameDesign, type Seeded } from '@dazbee/editor/test-matrix'
import type { AutoLayout } from '@dazbee/schema'

import { set, type Target } from './target.ts'
import { lineGapOf, lineGapPatch, wrapApplies, wrapPatch } from './wrap.ts'

const ROW: AutoLayout = {
  direction: 'row',
  gap: 10,
  padding: { top: 0, right: 0, bottom: 0, left: 0 },
  justify: 'start',
  align: 'start',
}
const tile = (index: string): Seeded =>
  ({
    type: 'graphic',
    parentId: 'row',
    index,
    name: 'Tile',
    props: { x: 0, y: 0, width: 200, height: 50, shape: { kind: 'rect' } },
  }) as Seeded
/** A row that fits its three 200-wide tiles both ways, 620 wide. */
function design(sizing: 'hug' | 'fixed', width = 10) {
  return frameDesign({
    name: 'Wrap',
    nodes: {
      row: {
        type: 'box',
        parentId: 'sq',
        index: 'a0',
        name: 'Row',
        props: { x: 0, y: 0, width, height: 10, sizing: { width: sizing, height: 'hug' }, layout: ROW },
      },
      a: tile('a0'),
      b: tile('a1'),
      c: tile('a2'),
    },
  })
}
/** The box as the layout section acts on it. */
function targetOf(ed: TestEditor, ids: string[]): Target {
  const design = ed.core.design()
  return {
    editor: ed.core as unknown as Editor,
    ids,
    props: ids.map((id) => ed.core.drawnPropsOf(id)) as Target['props'],
    types: ids.map((id) => design.nodes[id]?.type ?? ''),
    names: ids.map((id) => design.nodes[id]?.name ?? ''),
  }
}

describe('wrapApplies', () => {
  it('offers wrap to a row and a column, not a grid or a Free box', () => {
    expect(wrapApplies(ROW)).toBe(true)
    expect(wrapApplies({ direction: 'column' })).toBe(true)
    expect(wrapApplies({ direction: 'grid' })).toBe(false)
    expect(wrapApplies(undefined)).toBe(false)
  })
})

describe('wrapPatch', () => {
  let ed: TestEditor | undefined
  afterEach(() => ed?.end())

  it('fixes a row that fits its width at the width it is drawn at, so turning wrap on changes nothing until it is narrowed', async () => {
    ed = await testEditor(design('hug'))
    expect(set(targetOf(ed, ['row']), (now) => wrapPatch(now, true))).toBe(true)
    const row = ed.core.design().nodes.row
    expect(row?.props).toMatchObject({ sizing: { width: 'fixed', height: 'hug' }, layout: { wrap: true } })
    expect(ed.core.drawnPropsOf('row')).toMatchObject({ width: 620, height: 50 })
    // One undo step takes back the wrap and the width alike.
    ed.core.session.undo()
    expect(ed.core.design().nodes.row?.props).toMatchObject({ sizing: { width: 'hug', height: 'hug' } })
    expect(ed.core.design().nodes.row?.props).not.toHaveProperty('layout.wrap')
  })

  it('wraps a row that keeps its width at once, its height fitting the lines', async () => {
    ed = await testEditor(design('fixed', 420))
    set(targetOf(ed, ['row']), (now) => wrapPatch(now, true))
    expect(ed.core.drawnPropsOf('c')).toMatchObject({ x: 0, y: 60 })
    expect(ed.core.drawnPropsOf('row')).toMatchObject({ width: 420, height: 110 })
    set(targetOf(ed, ['row']), (now) => wrapPatch(now, false))
    expect(ed.core.drawnPropsOf('c')).toMatchObject({ x: 420, y: 0 })
  })

  it('fixes the drawn length tidied as the field shows it', () => {
    const now = { width: 200 / 3, sizing: { width: 'hug', height: 'hug' }, layout: ROW }
    expect(wrapPatch(now, true)).toMatchObject({ width: 66.67 })
  })

  it('leaves a grid and a Free box be', () => {
    expect(wrapPatch({ layout: { ...ROW, direction: 'grid' } }, true)).toBeNull()
    expect(wrapPatch({}, true)).toBeNull()
  })
})

describe('lineGapPatch', () => {
  it('sets the room between lines, gathering spread lines again', () => {
    expect(lineGapPatch(ROW, 24)).toEqual({ lineGap: 24 })
    expect(lineGapPatch({ ...ROW, alignLines: 'space-between' }, 24)).toEqual({ lineGap: 24, alignLines: 'packed' })
  })
})

describe('lineGapOf', () => {
  it('reads a box’s own room between lines, or its gap where it sets none', () => {
    expect(lineGapOf(ROW)).toBe(10)
    expect(lineGapOf({ ...ROW, lineGap: 30 })).toBe(30)
  })
})
