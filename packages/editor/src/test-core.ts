// The fixtures of the core's tests: the designs every action of the shortcut table runs on and the
// designs of the stage's own tests, running an action as a person does, and what an action can
// change, read off the test editor.
import type { DesignInput } from '@dazbee/schema'

import { HALF } from './canvas/test-images.ts'
import { type ShortcutAction, SHORTCUTS, type StageAction } from './shortcuts.ts'
import { DESIGN, FLOW, WORDS } from './test-actions.ts'
import { type TestEditor, testEditor, type TestEditorOptions } from './test-editor.ts'

/** The designs the actions run on, each with the layers usually selected in it. */
export const DESIGNS: Record<string, { design: DesignInput; usual: string[] }> = {
  'three squares': { design: DESIGN, usual: ['a', 'b', 'c'] },
  'a row laid out by auto layout': { design: FLOW, usual: ['fixed', 'filling'] },
  'a text': { design: WORDS, usual: ['words'] },
}
/** The actions whose usual selection is a box: the row every design has. */
export const ON_A_BOX: readonly ShortcutAction[] = ['ungroup', 'goIn', 'layoutFree']

/** The square frame holding a row laid out by auto layout, holding a button that hugs its label. */
export const BUTTON: DesignInput = {
  ...DESIGN,
  nodes: {
    bar: {
      type: 'box',
      parentId: 'sq',
      link: 'bar',
      index: 'a0',
      name: 'Bar',
      props: { x: 100, y: 100, width: 880, height: 200, layout: { direction: 'row', gap: 24, align: 'center' } },
    },
    btn: {
      type: 'box',
      parentId: 'bar',
      link: 'btn',
      index: 'a0',
      name: 'Button',
      props: {
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        sizing: { width: 'hug', height: 'hug' },
        layout: { direction: 'row', padding: { top: 16, right: 32, bottom: 16, left: 32 } },
      },
    },
    label: {
      type: 'text',
      parentId: 'btn',
      link: 'label',
      index: 'a0',
      name: 'Label',
      props: {
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        text: 'Buy',
        boxMode: 'autoWidth',
        style: { fontFamily: 'Noto Sans', fontSize: 40, fontWeight: 700, color: '#000000FF' },
      },
    },
  },
}
/** The design with a label lower in the square, a short text whose width grows with its words. */
export const LABEL: DesignInput = {
  ...DESIGN,
  nodes: {
    ...DESIGN.nodes,
    label: {
      type: 'text',
      parentId: 'sq',
      link: 'label',
      index: 'a5',
      name: 'Label',
      props: {
        x: 450,
        y: 650,
        width: 60,
        height: 27,
        text: 'Label',
        boxMode: 'autoWidth',
        style: { fontFamily: 'Noto Sans', fontSize: 20, color: '#3E2723FF' },
      },
    },
  },
}
/** The design with a panel lower in the square and over it a text box far taller and wider than its one short line. */
export const SALE: DesignInput = {
  ...DESIGN,
  nodes: {
    ...DESIGN.nodes,
    panel: {
      type: 'graphic',
      parentId: 'sq',
      link: 'panel',
      index: 'a5',
      name: 'Panel',
      props: {
        x: 40,
        y: 660,
        width: 640,
        height: 380,
        shape: { kind: 'rect' },
        fills: [{ type: 'solid', color: '#E7E2DAFF' }],
      },
    },
    words: {
      type: 'text',
      parentId: 'sq',
      link: 'words',
      index: 'a6',
      name: 'Words',
      props: {
        x: 60,
        y: 680,
        width: 600,
        height: 300,
        text: 'Sale',
        boxMode: 'fixed',
        style: { fontFamily: 'Noto Sans', fontSize: 64, color: '#000000FF' },
      },
    },
  },
}
/**
 * Two pages: the first's square frame holds a 600 × 600 photo whose image, asset `a1`, fills it;
 * the second holds an empty wide frame.
 */
export const PHOTO_PAGES: DesignInput = {
  meta: { designId: 'd', name: 'D' },
  pages: { p1: { name: 'One', order: 'a0' }, p2: { name: 'Two', order: 'a1' } },
  frames: {
    sq: { pageId: 'p1', name: 'Square', width: 1080, height: 1080, x: 0, y: 0, order: 'a0' },
    wide: { pageId: 'p2', name: 'Wide', width: 1920, height: 1080, x: 0, y: 0, order: 'a0' },
  },
  nodes: {
    photo: {
      type: 'graphic',
      parentId: 'sq',
      link: 'photo',
      index: 'a0',
      name: 'Photo',
      props: {
        x: 140,
        y: 140,
        width: 600,
        height: 600,
        shape: { kind: 'rect' },
        fills: [{ type: 'image', assetId: 'a1', fit: 'fill' }],
      },
    },
  },
}

/**
 * Runs an action as a person does: its first key from the shortcut table through the keys; an
 * action with no key through `perform`; a copy, a cut and a paste through the clipboard, as the
 * browser's own events bring them, the paste bringing what a copy just gave.
 */
export function run(editor: TestEditor, action: ShortcutAction) {
  const row = SHORTCUTS.find((s) => s.action === action)
  if (action === 'copy') editor.clipboard.copy()
  else if (action === 'cut') editor.clipboard.cut()
  else if (action === 'paste') editor.clipboard.paste(editor.clipboard.copy() ?? {})
  else if (row?.keys.length === 0) editor.core.perform(action as StageAction)
  else editor.press(action)
}

/** The design as it is now, as text: the session's own is a view that changes with it. */
export const stored = ({ core }: TestEditor) => JSON.stringify(core.design())
/** The words of the text layer the design with a text has. */
export const textOf = ({ core }: TestEditor) => {
  const node = core.design().nodes.words
  return node?.type === 'text' ? node.props.text : undefined
}
/** What an action can change besides the design: the selection, the picked frame, the tool, the camera, the rulers, the hidden layers shown, the text being edited and what the device keeps. */
export const around = ({ core, remembered }: TestEditor) =>
  JSON.stringify([
    core.selection(),
    core.pickedFrame(),
    core.tool(),
    core.camera(),
    core.rulers(),
    core.hiddenShown(),
    core.textSelection(),
    [...remembered],
  ])

/** Opens the test editor on the two pages with a photo, its image the half-clear one, its left half opaque. */
export function openPhotoPages(options: Pick<TestEditorOptions, 'access'> = {}) {
  const bytes = HALF.encodeToBytes()
  if (!bytes) throw new Error('no image')
  return testEditor(PHOTO_PAGES, { ...options, sources: { assetBytes: () => Promise.resolve(bytes) } })
}
