// What the keys, menus and fields do to a frame: the picked frame's keys (Esc, Delete, Duplicate and
// the arrows), adding a frame of a size or a size of a frame, resizing a frame by its typed size,
// and showing a frame just added.
import { descendants, round, type Session, smallerRatio } from '@dazbee/doc'
import { type Design, type Frame, sizeIssue } from '@dazbee/schema'

import type { EditorView } from './canvas/view.ts'
import { listenerSet } from './listener-set.ts'
import { runQuietly } from './run-quietly.ts'
import type { EditorSelection } from './selection.ts'
import { NUDGES, type ShortcutAction } from './shortcuts.ts'
import type { EditorTyping } from './text/typing.ts'
import type { EditorTools } from './tools.ts'

export interface FrameActionsDeps {
  session: Session
  view: Pick<EditorView, 'page' | 'showWhole'>
  tools: Pick<EditorTools, 'setTool'>
  /** The name a frame added from a size takes, in the app's words. */
  frameName: (width: number, height: number) => string
  selection: Pick<EditorSelection, 'pickFrame'>
  typing: Pick<EditorTyping, 'fitText'>
  /** Tells that what is shown changed. */
  shownChanged: () => void
}

/** A frame's width and height. */
export interface Size {
  width: number
  height: number
}

export interface EditorFrameActions {
  /** What a key does to the picked frame; false for a key that does nothing to it. */
  frameAction(action: ShortcutAction, frameId: string): boolean
  /**
   * Adds an empty white frame of a size to the shown page, under the name given (a size tile's) or
   * else named after the size, where the frame rule puts it, as one undo step, then shows it as
   * `showAdded` does. Returns its id; null, with nothing changed, for a size past the limits.
   */
  addFrame(size: Size, name?: string): string | null
  /**
   * Add size: a frame of a size on a frame's page, holding linked copies of its layers scaled to it
   * and placed by their constraints (`frame.addSize`), under its name, where the frame rule puts
   * it, each text whose width the placing changed fitted to its words, as one undo step, then shown
   * as `showAdded` does. Returns its id; null, with nothing changed, for a frame gone or a size past
   * the limits.
   */
  addSize(frameId: string, size: Size): string | null
  /**
   * Resizes a frame from its top left, its layers following their constraints (`frame.resize`), each
   * text whose width that changed fitted to its words, as one undo step called `resize`. Returns
   * whether it did; false, with nothing written, for a frame gone or a size `sizeIssue` refuses.
   */
  resizeFrame(frameId: string, size: Size): boolean
  /**
   * Shows a frame just added: picks it, the select tool back, and glides to bring it whole into view
   * with its label beside the chrome along the least pan, zoomed out only when it doesn't fit
   * (`showWhole`). Nothing for a frame gone.
   */
  showAdded(frameId: string): void
  /** Calls back with a frame's name once Delete has deleted it as the picked frame, so the page can offer its undo. */
  onFrameDelete(listener: (name: string) => void): () => boolean
}

export function editorFrameActions({
  session,
  view: { page, showWhole },
  tools,
  frameName,
  selection,
  typing,
  shownChanged,
}: FrameActionsDeps): EditorFrameActions {
  /** Told of each frame Delete deleted, by its name. */
  const frameDeletes = listenerSet<[name: string]>()

  /**
   * What a key does to the picked frame: Esc lets it go, Delete deletes it with its layers, Mod+D
   * duplicates it, picks the copy and glides to show it whole beside the chrome (`showWhole`), and
   * the arrows move it; each is one undo step. The layers' other keys do nothing to it.
   */
  function frameAction(action: ShortcutAction, frameId: string): boolean {
    if (!actsOnFrame(action)) return false
    const step = NUDGES[action]
    const stored = session.design().frames[frameId]
    if (step) {
      // Another tab may have deleted the frame a moment ago; the key then does nothing.
      if (!stored) return false
      runQuietly(() => session.run('frame.update', { frameId, x: stored.x + step[0], y: stored.y + step[1] }))
    } else if (action === 'deselect') {
      selection.pickFrame(null)
    } else if (action === 'delete') {
      // A frame whose delete is refused, as a tab that may only view refuses it, stays picked.
      const deleted = stored !== undefined && runQuietly(() => session.run('frame.delete', { frameId }))
      if (deleted) frameDeletes.emit(stored.name)
      if (deleted || !stored) selection.pickFrame(null)
    } else {
      let copy = ''
      if (runQuietly(() => (copy = session.run('frame.duplicate', { frameId })))) selection.pickFrame(copy)
      const made = session.design().frames[copy]
      if (made) showWhole({ x: made.x, y: made.y, width: made.width, height: made.height })
    }
    shownChanged()
    return true
  }

  function addFrame({ width, height }: Size, name = frameName(width, height)) {
    return added(() => session.run('frame.add', { pageId: page(), name, width, height }))
  }

  function addSize(frameId: string, { width, height }: Size) {
    const before = session.design()
    const size = { width, height }
    return added(() =>
      session.gesture('addSize', () => {
        const id = session.run('frame.addSize', { frameId, width, height })
        const now = session.design()
        const scaled = scaledWidths(before, frameId, size)
        fitResizedTexts(now, id, (copy) => scaled.get(now.nodes[copy]?.link ?? ''), typing.fitText)
        return id
      }),
    )
  }

  function resizeFrame(frameId: string, { width, height }: Size) {
    const design = session.design()
    if (!design.frames[frameId] || sizeIssue(width, height)) return false
    // The design is live: the widths are kept as they are before the resize changes them.
    const before = new Map(descendants(design, frameId).map((id) => [id, design.nodes[id]?.props.width]))
    return runQuietly(() =>
      session.gesture('resize', () => {
        session.run('frame.resize', { frameId, width, height })
        fitResizedTexts(session.design(), frameId, (id) => before.get(id), typing.fitText)
      }),
    )
  }

  function showAdded(frameId: string) {
    const made = session.design().frames[frameId]
    if (!made) return
    tools.setTool('select')
    selection.pickFrame(frameId)
    showWhole({ x: made.x, y: made.y, width: made.width, height: made.height })
    shownChanged()
  }

  /** Runs a command that adds a frame and shows the frame: its id, or null when the command refused. */
  function added(add: () => string): string | null {
    let id = ''
    if (!runQuietly(() => (id = add()))) return null
    showAdded(id)
    return id
  }

  return {
    frameAction,
    addFrame,
    addSize,
    resizeFrame,
    showAdded,
    onFrameDelete: frameDeletes.on,
  }
}

/**
 * Fits to its words, with `fitText`, each text under a frame in `design` whose width differs from
 * the one `widthBefore` gives it, as a step that resized the frame's layers left it: the width
 * stays, and the height follows its words where it grows with them. A text `widthBefore` gives no
 * width for is left as it is.
 */
export function fitResizedTexts(
  design: Design,
  frameId: string,
  widthBefore: (id: string) => number | undefined,
  fitText: (id: string) => void,
) {
  for (const id of descendants(design, frameId)) {
    const node = design.nodes[id]
    const was = widthBefore(id)
    if (node?.type === 'text' && was !== undefined && node.props.width !== was) fitText(id)
  }
}

/** Whether a key acts on the picked frame while no layer is selected: Esc, Delete, Duplicate and the arrows. */
export function actsOnFrame(action: ShortcutAction) {
  return action === 'deselect' || action === 'delete' || action === 'duplicate' || NUDGES[action] !== undefined
}

/**
 * The width each layer of a frame takes from Add size's scale to `size` alone, before its
 * constraints place it, by its link id, which its copy shares.
 */
function scaledWidths(design: Design, frameId: string, size: Size): Map<string, number> {
  const frame = design.frames[frameId] as Frame
  const s = smallerRatio({ from: frame, to: size })
  const widths = new Map<string, number>()
  for (const id of descendants(design, frameId)) {
    const node = design.nodes[id]
    if (node) widths.set(node.link, round(node.props.width * s))
  }
  return widths
}
