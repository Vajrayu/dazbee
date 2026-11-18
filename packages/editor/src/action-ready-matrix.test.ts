// Whether an action can run now, held against what running it does (`runState`), over the gesture
// matrix's design: a crop, auto layout and its flows, masks, booleans, a hidden layer, layers locked
// against deleting, styling and editing, selections across frames, an empty page, a drawing tool
// and a Reviewer's tab, one test per state; and named cases. Align,
// distribute and the arrows read what can move, not where it is, so here they may be ready on
// layers lined up already or at a flow's end and change nothing.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { DesignInput } from '@dazbee/schema'

import { HALF } from './canvas/test-images.ts'
import type { ShortcutAction } from './shortcuts.ts'
import { runState, type State } from './test-action-ready.ts'
import { type TestEditor, testEditor } from './test-editor.ts'
import { copyIn } from './test-matrix/index.ts'
import { matrixDesign } from './test-matrix/matrix-design.ts'

/** The photo's image, by its asset id. */
const PHOTO_ID = 'matrix-photo'
const PHOTO = HALF.encodeToBytes() as Uint8Array
const SOURCES = {
  assetBytes: (id: string) => (id === PHOTO_ID ? Promise.resolve(PHOTO) : Promise.reject(new Error(id))),
}
/** What a tab may only view is told: nothing, so it only views. */
const VIEW_ONLY = { readOnly: () => true, onChange: () => () => {} }
/** A layer's linked copy in the wide frame. */
const W = (id: string) => copyIn('wide', id)

/**
 * The matrix's design with locks on some of the wide frame's copies (a shape against deleting, a
 * group every way, a text's content, a photo's style), its box's layer hidden, and a second page
 * with no frames.
 */
function design(): DesignInput {
  const made = structuredClone(matrixDesign(PHOTO_ID)) as DesignInput & {
    nodes: Record<string, { lock?: object; props: { visible?: boolean } }>
  }
  const at = (id: string) => {
    const node = made.nodes[id]
    if (!node) throw new Error(`the matrix has no ${id}`)
    return node
  }
  at(W('shape')).lock = { delete: true }
  at(W('gA')).lock = { move: true, resize: true, content: true, style: true, delete: true }
  at(W('boxInner')).props.visible = false
  at(W('tWide')).lock = { content: true }
  at(W('photo')).lock = { style: true }
  made.pages.p2 = { name: 'Two', order: 'a1' }
  return made
}

const select =
  (...ids: string[]) =>
  (ed: TestEditor) =>
    ed.core.select(ids)

/** A layer of a group selected with the group gone into, as a double click leaves it. */
const goneInto = (ed: TestEditor) => {
  ed.core.select(['gA'])
  ed.modules.selection.enter('group')
}

/** The states of a tab that may edit. */
const EDITING: State[] = [
  {
    name: 'a photo being cropped',
    setup: (ed) => {
      ed.core.select(['photo'])
      ed.core.perform('editPoints')
      if (!ed.modules.selection.cropping()) throw new Error('no crop')
    },
  },
  { name: 'a photo', setup: select('photo') },
  { name: 'a path', setup: select('pen') },
  { name: 'a box laid out by auto layout', setup: select('auto') },
  { name: 'a layer at the start of a flow', setup: select('aFixed') },
  { name: 'three layers in a flow', setup: select('aFixed', 'aFill', 'aHug') },
  { name: 'a layer in a flow and one placed apart from it', setup: select('aFixed', 'aAbs') },
  { name: 'a mask and the layer it masks', setup: select('mask', 'masked') },
  { name: 'a boolean', setup: select('bool') },
  { name: 'a shape in a boolean', setup: select('bA') },
  { name: 'a hidden layer alone in its box', setup: select(W('boxInner')) },
  { name: "a turned group's layer alone in it", setup: select('tInner') },
  { name: 'a shape locked against deleting', setup: select(W('shape')) },
  { name: 'a layer locked every way', setup: select(W('gA')) },
  { name: 'a text locked against editing', setup: select(W('tWide')) },
  { name: 'a photo with its style locked', setup: select(W('photo')) },
  { name: 'a photo and its linked copy', setup: select('photo', W('photo')) },
  { name: 'shapes in two frames', setup: select('shape', 'apartShape') },
  { name: 'a free shape and one locked against deleting, in two frames', setup: select('apartShape', W('shape')) },
  { name: 'two shapes in one frame and one in another', setup: select('shape', 'pen', 'apartShape') },
  { name: "a boolean's two shapes and a shape in another frame", setup: select('bA', 'bB', 'apartShape') },
  { name: 'a mask, its layer and a shape in another frame', setup: select('mask', 'masked', 'apartShape') },
  { name: 'a group gone into', setup: goneInto },
  { name: 'a page with no frames', setup: (ed) => ed.core.showPage('p2') },
  { name: 'the rectangle tool, nothing selected', setup: (ed) => ed.core.setTool('rect') },
  {
    name: 'the rectangle tool, a shape selected',
    setup: (ed) => {
      ed.core.select(['shape'])
      ed.core.setTool('rect')
    },
  },
  {
    name: 'typing with a caret',
    setup: (ed) => {
      ed.core.select(['tWide'])
      ed.core.perform('goIn')
      ed.modules.typing.selectText({ start: 2, end: 2 })
    },
  },
]
/** The states of a Reviewer's tab. */
const VIEWING: State[] = [
  { name: 'a photo', setup: select('photo') },
  { name: 'a path', setup: select('pen') },
  { name: 'a layer at the start of a flow', setup: select('aFixed') },
  { name: 'a layer at the end of a flow', setup: select('aHug') },
  { name: 'a layer at the start of a column', setup: select('colA') },
  { name: 'a hidden layer alone in its box', setup: select(W('boxInner')) },
  { name: "a turned group's layer alone in it", setup: select('tInner') },
  { name: 'shapes in two frames', setup: select('shape', 'apartShape') },
  { name: 'a group gone into', setup: goneInto },
  { name: 'a picked frame', setup: (ed) => ed.core.pickFrame('apart') },
  { name: 'a page with no frames', setup: (ed) => ed.core.showPage('p2') },
]

describe('actionReady over the matrix', () => {
  let editing: TestEditor
  let viewing: TestEditor
  beforeAll(async () => {
    editing = await testEditor(design(), { sources: SOURCES })
    viewing = await testEditor(design(), { sources: SOURCES, access: VIEW_ONLY })
  })
  afterAll(() => {
    editing.end()
    viewing.end()
  })

  it.each(EDITING)(
    'is false exactly when running the action changes nothing, in a tab that may edit: $name',
    (state) => {
      expect(runState(editing, state, { still: true }).wrong).toEqual([])
    },
  )

  it.each(VIEWING)('is false exactly when running the action changes nothing, in a Reviewer’s tab: $name', (state) => {
    expect(runState(viewing, state, { still: true }).wrong).toEqual([])
  })

  it("holds for Delete, Combine, Tab, Select all and a Reviewer's Enter by name", () => {
    const ready = (ed: TestEditor, setup: (ed: TestEditor) => void, action: ShortcutAction) => {
      setup(ed)
      const answer = ed.core.actionReady(action)
      ed.core.select([])
      ed.core.showPage('p1')
      return answer
    }
    // Delete and Cut run in each frame that can: one frame's shape goes, the other's locked one stays.
    expect(ready(editing, select('apartShape', W('shape')), 'delete')).toBe(true)
    expect(ready(editing, select('apartShape', W('shape')), 'cut')).toBe(true)
    expect(ready(editing, select(W('shape')), 'delete')).toBe(false)
    // Combine runs in each frame with two shapes or more.
    expect(ready(editing, select('shape', 'pen', 'apartShape'), 'booleanUnion')).toBe(true)
    expect(ready(editing, select('shape', 'apartShape'), 'booleanUnion')).toBe(false)
    // Tab on a layer alone in what holds it selects nothing new and goes into nothing.
    expect(ready(editing, select('tInner'), 'nextLayer')).toBe(false)
    // Select all on a page with no frames has nothing to select.
    expect(ready(editing, (ed) => ed.core.showPage('p2'), 'selectAll')).toBe(false)
    // A Reviewer's Enter on a photo or a path starts no crop and opens no points.
    expect(ready(viewing, select('photo'), 'goIn')).toBe(false)
    expect(ready(viewing, select('pen'), 'goIn')).toBe(false)
  })
})
