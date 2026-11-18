// Copy as PNG's key, Mod+Shift+C, which the page takes from the browser while the editor has
// something to copy: never in a field, a text being typed in or an open dialog, which keep the key.
import { useEffect } from 'react'

import { type Editor, shortcutFor } from '@dazbee/editor'
import { composingKey, inField, isStageField } from '@dazbee/editor/dom-input'

/** Copies as PNG on its key, from the key's own event, which lets the page write the clipboard. */
export function useCopyPngKey(editor: Editor | null) {
  useEffect(() => {
    if (!editor) return
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || composingKey(e) || shortcutFor(e) !== 'copyPng') return
      if (inField(e.target) || isStageField(e.target) || document.querySelector('dialog[open]')) return
      if (editor.copyPng()) e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editor])
}
