// The keys that walk the layer tree: Enter goes into the selection, selecting what is directly in its
// groups, boxes and booleans, typing into one text with all its words selected, or running the crop
// item's action on one photo or path; Shift+Enter goes out to the group it is in; Tab and Shift+Tab
// step to the layer beside it in the layers panel's order. Each selects as the layers panel would,
// going into the group of what it selects, and writes nothing.
import type { Session } from '@dazbee/doc'
import { childrenOf } from '@dazbee/doc'
import type { Design, Paint } from '@dazbee/schema'

import { lockedInPlace, shownIn } from './layers/boxes.ts'
import {
  childrenOfSelected,
  type EditorSelection,
  isPath,
  parentsOfSelected,
  type Picked,
  samePick,
  selectInto,
  type Selection,
  siblingOfSelected,
} from './selection.ts'
import type { StageAction } from './shortcuts.ts'
import type { EditorTyping } from './text/typing.ts'

/** What Enter does to a selection: goes inside what it holds, types into a text, or runs `editPoints`. */
export type GoInWay = 'inside' | 'type' | 'editPoints'

export interface ReachDeps {
  session: Pick<Session, 'design'>
  selection: Pick<EditorSelection, 'current' | 'enter' | 'selectAcross'>
  typing: Pick<EditorTyping, 'editing' | 'selectedText' | 'start' | 'selectText'>
}

export interface EditorReach {
  /**
   * Enter: selects what is directly in the selected groups, boxes and booleans, or starts typing in
   * one selected text, unless it is locked against edits, hidden or locked in place, with all its
   * words selected (in the text already typed in, selects them all, unless they are: `typingAllOf`).
   * Returns whether it did either; where Enter runs an action of its own (`goInAction`) it does
   * nothing.
   */
  goIn(): boolean
  /** Shift+Enter: selects the groups, boxes and booleans the selected layers are directly in; nothing at a frame's top level. */
  goOut(): void
  /** Tab, or Shift+Tab with -1: selects the layer beside the last selected one, a row down the layers panel, wrapping round. */
  step(by: 1 | -1): void
}

/**
 * Whether Enter may act on a layer, typing into it, cropping it or editing its points: it is drawn,
 * and neither it nor what holds it is locked in place.
 */
const enterable = (design: Design, id: string) => shownIn(design, id) && !lockedInPlace(design, id)

export function editorReach({ session, selection, typing }: ReachDeps): EditorReach {
  function goIn() {
    const current = selection.current()
    if (!current) return false
    const design = session.design()
    const way = goInWay(
      design,
      current.map(({ id }) => id),
    )
    if (way === 'inside') {
      selectInto(selection, design, childrenOfSelected(current, design))
      return true
    }
    const [only] = current
    const node = only && design.nodes[only.id]
    if (way !== 'type' || !only || node?.type !== 'text' || typingAllOf(design, only.id, typing)) return false
    // The text already typed in keeps its typing step: its words are selected in it.
    if (typing.editing()?.id !== only.id) typing.start(only.id, only.frameId, 0)
    typing.selectText({ start: 0, end: node.props.text.length })
    return true
  }
  function goOut() {
    const design = session.design()
    const parents = parentsOfSelected(selection.current() ?? [], design)
    if (parents.length > 0) selectInto(selection, design, parents)
  }
  function step(by: 1 | -1) {
    const design = session.design()
    const next = layerBeside(selection.current(), design, by)
    if (next) selectInto(selection, design, [next])
  }

  return { goIn, goOut, step }
}

/**
 * The action with a name of its own that Enter runs on the selected layers `ids` of a design:
 * `editPoints` on one layer that holds no layers and has an image fill, cropping it, or on one path,
 * opening its points. Null where Enter goes into what the layers hold, types into a text, or does
 * nothing: on a layer hidden, locked in place or with its style locked, or on several layers.
 */
export function goInAction(design: Design, ids: readonly string[]): StageAction | null {
  return goInWay(design, ids) === 'editPoints' ? 'editPoints' : null
}

/**
 * The layer Tab (1) or Shift+Tab (-1) selects: the one beside the last selected in the layers
 * panel's order, wrapping round; null with none, or for a layer selected alone in what holds it,
 * which would select itself again.
 */
export function layerBeside(current: Selection | null, design: Design, by: 1 | -1): Picked | null {
  const next = siblingOfSelected(current, design, by)
  const [only] = current ?? []
  return next && !(current?.length === 1 && only && samePick(only, next)) ? next : null
}

/** Whether a text is the one typed in now with all its words selected, where Enter has nothing left to do. */
export function typingAllOf(design: Design, id: string, typing: Pick<EditorTyping, 'editing' | 'selectedText'>) {
  const node = design.nodes[id]
  const range = typing.selectedText()?.range
  return (
    typing.editing()?.id === id && node?.type === 'text' && range?.start === 0 && range.end === node.props.text.length
  )
}

/**
 * What Enter does to the selected layers `ids` of a design: goes `inside` while any of them holds
 * layers; else, on one layer Enter may act on (`enterable`), types into a text not locked against
 * edits, or runs `editPoints` on a layer with an image fill or a path whose style is not locked.
 * Null when it does nothing.
 */
export function goInWay(design: Design, ids: readonly string[]): GoInWay | null {
  if (ids.some((id) => childrenOf(design, id).length > 0)) return 'inside'
  const [only] = ids
  const node = only !== undefined && ids.length === 1 ? design.nodes[only] : undefined
  if (only === undefined || !node || !enterable(design, only)) return null
  if (node.type === 'text' && !node.lock?.content) return 'type'
  if (node.lock?.style) return null
  return holdsImage(node.props) || isPath(design, only) ? 'editPoints' : null
}

/** Whether a layer's props hold an image fill, which the crop works on. */
function holdsImage(props: object) {
  return 'fills' in props && ((props.fills ?? []) as Paint[]).some((fill) => fill.type === 'image')
}
