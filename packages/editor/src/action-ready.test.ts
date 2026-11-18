// Whether an action can run now, held against what running it does (`runState`), over every row of
// the shortcut table in each selection and mode of a small design, one test per state, and named
// cases. action-ready-matrix.test.ts holds it over the gesture matrix's design.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { DesignInput } from '@dazbee/schema'

import type { ShortcutAction } from './shortcuts.ts'
import { type Found, REMEMBERED, runState, type State } from './test-action-ready.ts'
import { type TestEditor, testEditor } from './test-editor.ts'
import { copyIn, frameDesign, linkedFrames, type Seeded } from './test-matrix/index.ts'

const BLUE = { type: 'solid' as const, color: '#2F6BFFFF' }
const RED = { type: 'solid' as const, color: '#E5484DFF' }
const rect = (parentId: string, index: string, x: number, y: number, w: number, h: number, fill = BLUE): Seeded => ({
  type: 'graphic',
  parentId,
  index,
  name: 'Rect',
  props: { x, y, width: w, height: h, shape: { kind: 'rect' }, fills: [fill] },
})
/**
 * A square frame of three rectangles at uneven places, one of a style of its own, a rectangle
 * locked in place, a Free box holding one, a group of two, a text and a path; and a wide frame of
 * their linked copies.
 */
const DESIGN: DesignInput = linkedFrames(
  frameDesign({
    name: 'Ready',
    nodes: {
      r1: rect('sq', 'a0', 100, 100, 100, 100),
      r2: rect('sq', 'a1', 300, 250, 120, 80, RED),
      r3: rect('sq', 'a2', 700, 140, 60, 90),
      pin: { ...rect('sq', 'a3', 700, 700, 50, 50), lock: { move: true } },
      bx: { type: 'box', parentId: 'sq', index: 'a4', name: 'Box', props: { x: 100, y: 500, width: 300, height: 200 } },
      inBox: rect('bx', 'a0', 20, 20, 60, 60),
      grp: {
        type: 'group',
        parentId: 'sq',
        index: 'a5',
        name: 'Group',
        props: { x: 500, y: 600, width: 180, height: 130 },
      },
      g1: rect('grp', 'a0', 500, 600, 80, 80),
      g2: rect('grp', 'a1', 600, 650, 80, 80),
      txt: {
        type: 'text',
        parentId: 'sq',
        index: 'a6',
        name: 'Words',
        props: {
          x: 100,
          y: 800,
          width: 600,
          height: 120,
          text: 'Hello there',
          boxMode: 'fixed',
          style: { fontFamily: 'Noto Sans', fontSize: 80, color: '#000000FF' },
        },
      },
      pth: {
        type: 'graphic',
        parentId: 'sq',
        index: 'a7',
        name: 'Path',
        props: { x: 500, y: 350, width: 200, height: 150, shape: { kind: 'path', d: 'M0 0 L200 0 L200 150' } },
      },
    },
  }),
  [{ id: 'wide', name: 'Wide', width: 1200, height: 628 }],
)
/** What a tab may only view is told: nothing, so it only views. */
const VIEW_ONLY = { readOnly: () => true, onChange: () => () => {} }

const select =
  (...ids: string[]) =>
  (ed: TestEditor) =>
    ed.core.select(ids)
/** Typing in the text, two words of it selected. */
const typing = (ed: TestEditor) => {
  ed.core.select(['txt'])
  ed.core.perform('goIn')
  ed.modules.typing.selectText({ start: 1, end: 4 })
}
/** The layers of the first rectangle copied and its style copied, and the second one selected. */
const copied = (ed: TestEditor) => {
  ed.core.select(['r1'])
  ed.clipboard.copyLayers()
  ed.core.perform('copyStyle')
  ed.core.select(['r2'])
}
/** The pen drawing a path of two corners in the square frame. */
const penDrawing = (ed: TestEditor) => {
  ed.core.setTool('pen')
  const [a, b] = [ed.core.stagePoint(850, 300, 'sq'), ed.core.stagePoint(950, 380, 'sq')]
  ed.mouse.click(a.x, a.y)
  ed.mouse.click(b.x, b.y)
}
/** The path's points being edited. */
const pathEditing = (ed: TestEditor) => {
  ed.core.select(['pth'])
  ed.core.perform('editPoints')
}

/** The states of a tab that may edit. */
const EDITING: State[] = [
  { name: 'nothing selected', setup: () => {} },
  { name: 'one rectangle', setup: select('r1') },
  { name: 'two rectangles', setup: select('r1', 'r2') },
  { name: 'three rectangles', setup: select('r1', 'r2', 'r3') },
  { name: 'a layer locked in place', setup: select('pin') },
  { name: 'a box', setup: select('bx') },
  { name: 'a group', setup: select('grp') },
  { name: 'a text', setup: select('txt') },
  { name: 'typing with a range', setup: typing },
  { name: 'a picked frame', setup: (ed) => ed.core.pickFrame('sq') },
  { name: 'a layer and its copy in two linked frames', setup: select('r1', copyIn('wide', 'r1')) },
  { name: 'the pen drawing', setup: penDrawing },
  { name: "a path's points edited", setup: pathEditing },
  { name: 'layers and a style copied', setup: copied },
]
/** The states of a tab that may only view. */
const VIEWING: State[] = [
  { name: 'nothing selected', setup: () => {} },
  { name: 'one rectangle', setup: select('r1') },
  { name: 'a group', setup: select('grp') },
  { name: 'a text', setup: select('txt') },
  { name: 'a picked frame', setup: (ed) => ed.core.pickFrame('sq') },
  { name: 'layers and a style copied', setup: copied },
]

/** How many runs of each tab's states found the action ready and not, which the last test reads. */
const tally = { editing: { ready: 0, notReady: 0 }, viewing: { ready: 0, notReady: 0 } }
/** Adds a state's runs to its tab's tally and gives the disagreements. */
const counted = (tab: keyof typeof tally, { wrong, ready, notReady }: Found) => {
  tally[tab].ready += ready
  tally[tab].notReady += notReady
  return wrong
}

describe('actionReady', () => {
  let editing: TestEditor
  let viewing: TestEditor
  beforeAll(async () => {
    editing = await testEditor(DESIGN)
    viewing = await testEditor(DESIGN, { access: VIEW_ONLY })
  })
  afterAll(() => {
    editing.end()
    viewing.end()
  })

  it('brings each state of the grid about', async () => {
    const ed = await testEditor(DESIGN)
    const { core, modules, remembered } = ed
    typing(ed)
    expect(modules.typing.selectedText()).toEqual({ id: 'txt', range: { start: 1, end: 4 } })
    core.settle()
    penDrawing(ed)
    expect(modules.pen.drawing()).toBe(true)
    core.settle()
    pathEditing(ed)
    expect(modules.selection.pathEditing()?.id).toBe('pth')
    copied(ed)
    expect(REMEMBERED.map((key) => remembered.has(key))).toEqual([true, true])
    expect(core.selection()).toEqual(['r2'])
    ed.end()
  })

  it.each(EDITING)(
    'is false exactly when running the action changes nothing, in a tab that may edit: $name',
    (state) => {
      expect(counted('editing', runState(editing, state))).toEqual([])
    },
  )

  it.each(VIEWING)(
    'offers only the actions that view in a tab that may only view, each only when it changes something: $name',
    (state) => {
      expect(counted('viewing', runState(viewing, state))).toEqual([])
    },
  )

  it('holds both sides of the rule many times over: about 670 runs ready and 420 not in a tab that may edit', () => {
    expect(Math.min(tally.editing.ready, tally.editing.notReady)).toBeGreaterThan(300)
    expect(tally.viewing.ready).toBeGreaterThan(50)
    viewing.core.select(['r1'])
    for (const action of ['group', 'delete', 'duplicate', 'paste', 'cut', 'undo', 'toolRect', 'saveVersion'] as const)
      expect(viewing.core.actionReady(action), action).toBe(false)
    // A Reviewer still opens the Versions card, to list and view; an Editor saves a version too.
    expect(viewing.core.actionReady('showVersions')).toBe(true)
    expect([editing.core.actionReady('saveVersion'), editing.core.actionReady('showVersions')]).toEqual([true, true])
    viewing.core.select([])
  })

  it('leaves out the actions whose key does nothing though perform says it ran', () => {
    const ready = (setup: (ed: TestEditor) => void, action: ShortcutAction) => {
      setup(editing)
      const answer = editing.core.actionReady(action)
      editing.core.select([])
      return answer
    }
    // Send backward and to the back with the layer at the back of its stack; forward still goes.
    expect(ready(select('r1'), 'sendBackward')).toBe(false)
    expect(ready(select('r1'), 'sendToBack')).toBe(false)
    expect(ready(select('r1'), 'bringForward')).toBe(true)
    // Combine with one shape, distribute with two, align and nudge on a layer locked in place.
    expect(ready(select('r1'), 'booleanUnion')).toBe(false)
    expect(ready(select('r1', 'r2'), 'booleanUnion')).toBe(true)
    expect(ready(select('r1', 'r2'), 'distributeHorizontal')).toBe(false)
    expect(ready(select('r1', 'r2', 'r3'), 'distributeHorizontal')).toBe(true)
    expect(ready(select('pin'), 'alignLeft')).toBe(false)
    expect(ready(select('pin'), 'nudgeLeft')).toBe(false)
    // The Select tool while it is the tool, Go out at a frame's top level, undo with no history and
    // paste with nothing copied.
    expect(ready(select('r1'), 'toolSelect')).toBe(false)
    expect(ready(select('r1'), 'toolHand')).toBe(true)
    expect(ready(select('r1'), 'goOut')).toBe(false)
    expect(ready(select('g1'), 'goOut')).toBe(true)
    expect(ready(select(), 'undo')).toBe(false)
    expect(ready(select(), 'paste')).toBe(false)
    expect(ready(select(), 'shortcuts')).toBe(true)
    expect(ready(select(), 'quickActions')).toBe(true)
  })
})
