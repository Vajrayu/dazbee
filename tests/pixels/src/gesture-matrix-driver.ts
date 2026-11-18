// The gesture matrix's driver in Node (@dazbee/editor/test-matrix, MatrixDriver): the matrix's
// design opened in the test editor on the stage the browser's spec has, its mouse and keys sending
// the inputs a browser sends, and the core read back. What an input or a redraw pass throws is kept
// as an error, as a browser keeps what its listeners throw; what the editor's calls (snapping,
// fitting a frame, selecting) throw rejects the call, as the browser's driver's call does.
import type { ShortcutAction } from '@dazbee/editor/shortcuts'
import { type Grabbed, type TestEditor, testEditor } from '@dazbee/editor/test-editor'
import { MATRIX_INSETS, MATRIX_STAGE, type MatrixDriver, sortedJson } from '@dazbee/editor/test-matrix'
import type { DesignInput, Point } from '@dazbee/schema'

/** What a copy puts on the clipboard. */
type Payload = NonNullable<ReturnType<TestEditor['clipboard']['copy']>>

/** The asset id the photo is opened under. */
const PHOTO_ID = 'gesture-matrix-photo'

/**
 * A driver that opens the matrix's design in a test editor, with `photo` as the photo's bytes;
 * `end` ends the editor last opened.
 */
export function nodeDriver(photo: Uint8Array): MatrixDriver & { end(): void } {
  // The test editor the design is open in, once it is.
  let opened: TestEditor | null = null
  // The errors raised since they were last taken.
  const errors: string[] = []
  // How many notices the core had raised when the design was opened.
  let noticesAtOpen = 0
  // What the last copy put on the clipboard.
  let clipboard: Payload | null = null

  function editor() {
    if (!opened) throw new Error('the gesture matrix design is not open')
    return opened
  }
  function zoom() {
    return Promise.resolve(editor().core.camera().zoom)
  }
  function stagePoint(x: number, y: number, frameId: string) {
    return Promise.resolve(editor().core.stagePoint(x, y, frameId))
  }
  function handleAt(handle: Grabbed) {
    return Promise.resolve(editor().at(handle))
  }
  function design() {
    return Promise.resolve(sortedJson(editor().core.design()))
  }
  function boxesOf(ids: readonly string[]) {
    return Promise.resolve(ids.map((id) => editor().core.boxOf(id) ?? null))
  }
  function exportPixels(frameId: string) {
    return Promise.resolve(editor().core.exportPixels(frameId))
  }
  function notices() {
    return Promise.resolve(editor().told.length - noticesAtOpen)
  }

  /** Runs an input or a redraw pass, keeping what it throws as an error. */
  function send(input: () => unknown) {
    try {
      input()
    } catch (thrown) {
      errors.push(thrown instanceof Error ? thrown.message : String(thrown))
    }
    return Promise.resolve()
  }
  async function open(design: (photoId: string) => DesignInput) {
    opened?.end()
    opened = await testEditor(design(PHOTO_ID), {
      viewport: MATRIX_STAGE,
      insets: MATRIX_INSETS,
      sources: {
        assetBytes: (id) => (id === PHOTO_ID ? Promise.resolve(photo) : Promise.reject(new Error(`no asset ${id}`))),
      },
    })
    noticesAtOpen = opened.told.length
    errors.length = 0
    clipboard = null
  }
  async function setSnapping(on: boolean) {
    editor().core.setSnapping(on)
  }
  async function fitFrame(frameId: string) {
    editor().core.fitFrame(frameId)
  }
  async function select(ids: string[]) {
    editor().core.select(ids)
  }
  function drawn() {
    return send(() => editor().core.redraw())
  }
  function move(to: Point, steps?: number) {
    return send(() => editor().mouse.move(to.x, to.y, steps === undefined ? {} : { steps }))
  }
  function down() {
    return send(() => editor().mouse.down())
  }
  function up() {
    return send(() => editor().mouse.up())
  }
  function press(action: ShortcutAction) {
    return send(() => editor().press(action))
  }
  function alt(down: boolean) {
    return send(() => (down ? editor().keys.down('Alt') : editor().keys.up('Alt')))
  }
  function selected() {
    return Promise.resolve(editor().core.selection())
  }
  /** Presses the copy key; a browser sends the copy event only when the editor did not take the key. */
  function copy() {
    return send(() =>
      editor().keys.press('Control+KeyC', {}, (taken) => {
        if (!taken) clipboard = editor().clipboard.copy() ?? clipboard
      }),
    )
  }
  /** Presses the paste key; a browser sends the paste event only when the editor did not take the key. */
  function paste() {
    return send(() =>
      editor().keys.press('Control+KeyV', {}, (taken) => {
        if (!taken && clipboard) editor().clipboard.paste(clipboard)
      }),
    )
  }
  function takeErrors() {
    return Promise.resolve(errors.splice(0))
  }
  function end() {
    opened?.end()
    opened = null
  }

  return {
    open,
    setSnapping,
    fitFrame,
    drawn,
    select,
    zoom,
    stagePoint,
    handleAt,
    mouse: { move, down, up },
    press,
    alt,
    selected,
    copy,
    paste,
    design,
    boxesOf,
    exportPixels,
    notices,
    takeErrors,
    end,
  }
}
