// Assets' key, I, which opens and closes the Assets flyout as its button does: never in a field, a
// text being typed in or an open dialog, which keep the key.
import { useEffect } from 'react'

import { shortcutFor } from '@dazbee/editor'
import { composingKey, inField, isStageField } from '@dazbee/editor/dom-input'

import { toggleFlyout } from './edit-store.ts'

/** Opens or closes Assets on its key; `phone` as the flyout's button takes it. */
export function useAssetsKey(phone: boolean) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || composingKey(e) || shortcutFor(e) !== 'assets') return
      if (inField(e.target) || isStageField(e.target) || document.querySelector('dialog[open]')) return
      e.preventDefault()
      toggleFlyout('assets', phone)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phone])
}
