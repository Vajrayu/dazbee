// What the gesture matrix asks of an open editor: the input it sends, the editor's calls it makes,
// and what it reads back. Every point is a stage point: CSS pixels from the top left of the canvas
// element. The Node driver (tests/pixels/src/gesture-matrix-driver.ts) answers it on the test editor.
import type { DesignInput, Point, Rect } from '@dazbee/schema'

import type { Handle } from '../layers/transform.ts'
import type { ShortcutAction } from '../shortcuts.ts'

/** The pointer, pressed and moved as a hand would. */
export interface MatrixMouse {
  /** Moves the pointer to a stage point, in `steps` moves (one by default). */
  move(to: Point, steps?: number): Promise<void>
  /** Presses the main button where the pointer is. */
  down(): Promise<void>
  /** Lets the main button go where the pointer is. */
  up(): Promise<void>
}

/** An editor the gesture matrix runs in. */
export interface MatrixDriver {
  /** Opens a fresh copy of the design `design` builds from the photo's asset id, with the notice count at 0. */
  open(design: (photoId: string) => DesignInput): Promise<void>
  /** Turns snapping on or off. */
  setSnapping(on: boolean): Promise<void>
  /** Fits a frame of the shown page into view. */
  fitFrame(frameId: string): Promise<void>
  /** Waits until what is drawn is up to date: after the pending redraw, if there is one. */
  drawn(): Promise<void>
  /** Selects layers, as the editor's `select` does. */
  select(ids: string[]): Promise<void>
  /** The camera's zoom. */
  zoom(): Promise<number>
  /** A design pixel of a frame of the shown page as a stage point. */
  stagePoint(x: number, y: number, frameId: string): Promise<Point>
  /**
   * Where a press grabs a corner or an edge of the selection now: a corner's handle, or the middle
   * of an edge; null for one the selection doesn't resize from.
   */
  handleAt(handle: Handle): Promise<Point | null>
  mouse: MatrixMouse
  /** Presses an action's first key from the shortcut table. */
  press(action: ShortcutAction): Promise<void>
  /** Presses Alt down, or lets it go, as a hand holds it through a drag. */
  alt(down: boolean): Promise<void>
  /** The ids of the selected layers. */
  selected(): Promise<string[]>
  /** Copies the selection with the copy key. */
  copy(): Promise<void>
  /** Pastes with the paste key. */
  paste(): Promise<void>
  /** The design as the document holds it now, as JSON with sorted keys, so the same design reads the same. */
  design(): Promise<string>
  /** Each layer's box as drawn in its frame, in design pixels, auto layout solved, in the order of `ids`; null for one with none. */
  boxesOf(ids: readonly string[]): Promise<(Rect | null)[]>
  /** The pixels of a frame's export, RGBA, a row of the frame's width after another; null when there are none. */
  exportPixels(frameId: string): Promise<Uint8Array | null>
  /** How many notices the editor has raised since the design was opened. */
  notices(): Promise<number>
  /** The errors raised since the last call, which it clears. */
  takeErrors(): Promise<string[]>
}
