// The keys held that change what a hover shows: the deep key, ⌘ on a Mac and Ctrl elsewhere, which
// outlines the deepest layer under the pointer, and Alt, which measures from the selection to what
// is under it and has a move carry copies or a reorder drop them; and Space's pan, which `pan.ts`
// holds. A key or the focus leaving changing either asks for a redraw and tells the pointer.
import type { EditorView } from '../canvas/view.ts'
import { deepKeyHeld } from '../shortcuts.ts'
import type { KeyInput, PointerInput } from './inputs.ts'
import type { EditorPan } from './pan.ts'

export interface HeldKeysDeps {
  view: Pick<EditorView, 'redraw'>
  pan: Pick<EditorPan, 'keyDown' | 'keyUp' | 'blur'>
  /** Whether this computer is Apple's, whose deep key is ⌘. */
  onMac: () => boolean
  /** Tells that a key pressed or let go of the deep key or Alt, or the window losing the focus let go of one. */
  keysChanged: () => void
}

export interface EditorHeldKeys {
  /** Whether the deep key is held, so the hover outlines the layer a press then reaches. */
  deep(): boolean
  /**
   * Whether Alt is held: the stage measures from the selection to what is under the pointer, a move
   * carries copies and a reorder drops them.
   */
  alt(): boolean
  /** Follows the held keys from a pointer input's; returns whether one changed. */
  followPointer(e: PointerInput): boolean
  /**
   * A key pressed while a text is typed in: follows the held keys, leaving Space to the text.
   * Returns whether it is Alt while the stage has the keys, so the browser's menu takes no focus.
   */
  followKey(e: KeyInput): boolean
  /**
   * A key pressed: follows the held keys, and Space's pan. Returns whether the key is the editor's
   * alone: Space's pan, or Alt while the stage has the keys (as `followKey`).
   */
  keyDown(e: KeyInput): boolean
  /** A key let go: as `keyDown`. Returns whether it is Alt let go while the stage has the keys. */
  keyUp(e: KeyInput): boolean
  /** The window losing the focus lets go of every held key. */
  blur(): void
}

export function editorHeldKeys({ view, pan, onMac, keysChanged }: HeldKeysDeps): EditorHeldKeys {
  /** Whether the deep key, ⌘ on a Mac and Ctrl elsewhere, is held, so the hover outlines the layer a press then reaches. */
  let deep = false
  /** Whether Alt is held. */
  let alt = false

  /**
   * Follows which keys are held, from a key or the focus leaving, showing what they change at the
   * next redraw, which reads the design as that key, such as Ctrl+Z, left it, and telling the change.
   */
  function hold(e: Pick<KeyInput, 'ctrlKey' | 'metaKey' | 'altKey'>) {
    if (!follow(e)) return
    view.redraw()
    keysChanged()
  }
  function followKey(e: KeyInput) {
    hold(e)
    return altOnStage(e)
  }
  function keyDown(e: KeyInput) {
    return followKey(e) || pan.keyDown(e)
  }
  function keyUp(e: KeyInput) {
    hold(e)
    pan.keyUp(e)
    return altOnStage(e)
  }
  function blur() {
    hold({ ctrlKey: false, metaKey: false, altKey: false })
    pan.blur()
  }
  /** Sets the held keys from an input's; returns whether one changed. */
  function follow(e: Pick<KeyInput, 'ctrlKey' | 'metaKey' | 'altKey'>) {
    const nextDeep = deepKeyHeld(e, onMac())
    if (deep === nextDeep && alt === e.altKey) return false
    deep = nextDeep
    alt = e.altKey
    return true
  }

  return { deep: () => deep, alt: () => alt, followPointer: follow, followKey, keyDown, keyUp, blur }
}

/** Whether a key is Alt itself, pressed or let go while the stage has the keys. */
function altOnStage(e: KeyInput) {
  return e.key === 'Alt' && e.target.stage
}
