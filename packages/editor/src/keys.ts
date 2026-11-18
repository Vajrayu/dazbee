// The keys of the stage: each key input goes to what it is for, undo and redo, the pointer's keys,
// the picked guide, the shortcuts or the text being edited.
import type { EditorGuideDrag } from './gestures/guides/guide-drag.ts'
import type { KeyAnswer, KeyInput } from './gestures/inputs.ts'
import type { EditorPointer } from './gestures/pointer.ts'
import type { EditorPlace } from './place.ts'
import { aimsPaste, keptFromBrowser, type StageAction, stageShortcutFor } from './shortcuts.ts'
import { isStyleToggle } from './text/text-edit.ts'
import type { EditorTyping } from './text/typing.ts'

export interface KeysDeps {
  place: Pick<EditorPlace, 'aimPaste'>
  typing: Pick<EditorTyping, 'editing' | 'key'>
  pointer: Pick<EditorPointer, 'keyDown' | 'keyUp' | 'followKey'>
  /** Delete, the arrows and Escape act on the picked guide, before the shortcuts. */
  guideDrag: Pick<EditorGuideDrag, 'key'>
  /** Does what a shortcut names, and says whether it did. */
  perform: (action: StageAction) => boolean
}

export interface EditorKeys {
  /** Takes one key input and answers whether it was the editor's, so the browser does nothing more with it. */
  key(e: KeyInput): KeyAnswer
}

export function editorKeys({ place, typing, pointer, guideDrag, perform }: KeysDeps): EditorKeys {
  /** Takes one key input: a key let go is the pointer's, a key pressed goes to what it is for. Answers whether it was the editor's. */
  function key(e: KeyInput): KeyAnswer {
    if (e.type === 'keydown') return onKey(e)
    return { handled: pointer.keyUp(e) }
  }
  /**
   * Sends a key to what it is for: undo and redo, the pointer's keys, the shortcuts, or the text
   * being edited. Answers whether it was the editor's, so the browser does nothing more with it.
   */
  function onKey(e: KeyInput): KeyAnswer {
    // An input method's keys act on its own text: no shortcut runs, and nothing is typed.
    if (e.target.field || e.composing) return { handled: false }
    // The paste event that follows doesn't say whether Shift was down.
    if (aimsPaste(e)) place.aimPaste(e.shiftKey)
    const action = stageShortcutFor(e)
    if (action === 'undo' || action === 'redo') return own(action)
    // Keys pressed in a popover, menu or dialog, such as Escape to close it, are its own, not the
    // stage's; undo and redo still are. Space still pans beside a dialog that says it is not modal,
    // as the edit panel does.
    if (e.target.dialog !== 'none') return { handled: e.target.dialog === 'modeless' && pointer.keyDown(e) }
    // The arrows in a toolbar are its own: they never move the selection, the picked frame or the caret.
    if (e.target.toolbarArrow) return { handled: false }
    // Enter on a button presses it: it never crops the photo or edits the path selected.
    if (e.target.buttonEnter) return { handled: false }
    // Tab walks the layers only while the stage has the keys; anywhere else it moves the focus.
    if ((action === 'nextLayer' || action === 'previousLayer') && !e.target.stage) return { handled: false }
    // The style keys are the stage's whatever is selected, so the browser's own never run over it.
    if (isStyleToggle(action)) return own(action)
    // Duplicate's key is the stage's with nothing selected and while typing too, so the browser
    // never takes it; while typing it copies nothing.
    if (action === 'duplicate') return own(typing.editing() ? null : action)
    // A key the stage keeps from the browser is its own even when its action did nothing.
    if (!typing.editing())
      return {
        handled:
          pointer.keyDown(e) || Boolean(action && (guideDrag.key(action) || perform(action))) || keptFromBrowser(e),
      }
    // While typing, Space types: the held keys are followed, and Alt is still the editor's.
    return { handled: pointer.followKey(e) || typing.key(e) }
  }

  /**
   * Runs the action of a key that is the editor's own whatever the action does, undo, redo, the
   * style keys and Duplicate, or none for a key that does nothing then: the key is the editor's even
   * when the action throws, and what it threw is given back.
   */
  function own(action: StageAction | null): KeyAnswer {
    try {
      if (action) perform(action)
      return { handled: true }
    } catch (thrown) {
      return { handled: true, thrown }
    }
  }

  return { key }
}
