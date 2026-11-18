'use client'

// How a pop-up opened from its own button closes, as Share's forms, the account menu and the phone's
// tool tray do: on Esc or a press outside it and its button. While it is open it stands over the
// edit panel and the stage's selection, so Esc closes it before them, and closes the menu opened
// last before one opened earlier; a pop-up opened over it, with the focus in it, closes before it.
import { useEffect, useEffectEvent, useRef } from 'react'

import { composingKey, stageHasKeys } from '@dazbee/editor/dom-input'

/** The attribute that marks what stands over the edit panel and the selection. */
const MARK = 'data-over-panel'
/** What stands over the edit panel and the selection, so Esc closes it first. */
export const OVER_PANEL = `[${MARK}]`

/** Where a pop-up drawn over the page sits, as Radix draws the editor's. */
const POP_UP = '[data-radix-popper-content-wrapper]'

/** The menus open now, the one opened last at the end. */
const shown: object[] = []

/**
 * Closes a menu on Esc or a press outside `box`, which holds the menu, and its `button`, which `box`
 * holds too unless the button sits elsewhere, as the tool tray's sits in the tab bar. A press in a
 * pop-up drawn over the page, such as a menu opened from inside it, or in a dialog opened over the
 * menu, is no press outside. Esc is the menu's before anything under it, unless a pop-up or a dialog
 * with the focus in it, or a list open in the menu, as a select's, takes it to close first; it gives
 * the focus back to the button when it was in the menu, or nowhere. `overPanelMark` goes on `box`,
 * marking it as standing over the panel while the menu is open.
 */
export function useMenuClose(open: boolean, close: () => void) {
  const box = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const onClose = useEffectEvent(close)
  useEffect(() => {
    if (!open) return
    const menu = {}
    shown.push(menu)
    const onKey = (event: KeyboardEvent) => {
      // An input method's Escape cancels what it composes.
      if (event.key !== 'Escape' || composingKey(event) || event.defaultPrevented || shown.at(-1) !== menu) return
      const at = document.activeElement
      const inMenu = at !== null && box.current?.contains(at) === true
      if (inPopUp(at) || inDialogOver(at, box.current)) return
      if (inMenu && at !== button.current && at.getAttribute('aria-expanded') === 'true') return
      event.stopImmediatePropagation()
      event.preventDefault()
      if (inMenu || stageHasKeys(at)) button.current?.focus()
      onClose()
    }
    const onPress = (event: PointerEvent) => {
      const at = event.target as Element
      if (box.current?.contains(at) || button.current?.contains(at) || inPopUp(at) || inDialogOver(at, box.current))
        return
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerdown', onPress)
    return () => {
      shown.splice(shown.indexOf(menu), 1)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pointerdown', onPress)
    }
  }, [open])
  return { box, button, overPanelMark: { [MARK]: open ? '' : undefined } }
}

/**
 * Whether an element is in a dialog opened over a menu, such as Quick actions opened from the tool
 * tray: the dialog takes its own Esc and presses, its backdrop's too, and the menu stays open under it.
 */
function inDialogOver(at: Element | null, box: Element | null) {
  const dialog = at?.closest('dialog[open]')
  return dialog != null && !(box && dialog.contains(box))
}

/** Whether the focus is in a pop-up drawn over the page, which closes first, on its own Esc. */
export function inPopUp(at: Element | null) {
  return at?.closest(POP_UP) != null
}
