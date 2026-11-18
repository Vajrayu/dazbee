'use client'

// The eyedropper: a button that picks a colour from the design for
// the control it sits in, pressed while it picks and pressed again to stop; Shift+I, which shows the
// selection's Style or the picked frame's Background and starts the eyedropper of its colour's "In
// this design" row; and what is said as picking starts (the stage's notice, which is a live region)
// and ends (a live region of its own).
// On a phone the panel or pop-up it sits in is hidden while it picks, never unmounted, so the stage
// under it can be picked from; the notice's Cancel stops it there, and once it ends it takes the
// focus back, so Esc closes the pop-up it is in.
import { useCallback, useEffect, useRef, useState } from 'react'

import { type Editor, shortcutFor } from '@dazbee/editor'
import { composingKey, inField, isStageField, KEEPS_PICKING } from '@dazbee/editor/dom-input'

import { colourPickedIn } from '@/components/editor/edit-panel/tabs/tabs.ts'
import { overPanel, pickSwitcherTab, setOpen } from '@/components/editor/edit-store.ts'
import { ICON_BUTTON, PANEL_SWATCH, SWATCH_FACE, SWATCH_TARGET } from '@/components/editor/styles.ts'
import { EyedropperIcon } from '@/components/ui/icons.tsx'
import { FOCUS_RING } from '@/components/ui/looks.ts'
import { hideSheets } from '@/components/ui/sheet-top.ts'
import { cn } from '@/lib/cn.ts'
import { useMessages } from '@/lib/i18n/client.tsx'
import { format } from '@/lib/i18n/index.ts'
import { usePhone } from '@/lib/phone.ts'

import { factsOf, kindOf, targetOf } from './target.ts'

/** What was last said about picking: its start, or its end. */
type Said = { text: string; start: boolean }

/** The attribute on the page's root that hides, on a phone, the panel and pop-ups over the stage while a colour is picked. */
const HIDES_POPUPS = 'data-picking-colour'

/**
 * An ask that the rows showing in the frame it was made in hear, every one of them, and no row
 * after: the row is there by the next frame, or never is. `nextFrame` runs a callback at the next
 * frame.
 */
export function frameAsk(nextFrame: (then: () => void) => void) {
  let asks = 0
  let open = false
  return {
    ask() {
      asks += 1
      const made = asks
      open = true
      nextFrame(() => {
        if (asks === made) open = false
      })
    },
    heard: () => open,
  }
}

/** Shift+I's ask for the "In this design" row's eyedropper to start, once it is there: until the next frame. */
const askedByKey = frameAsk((then) => requestAnimationFrame(then))

/** Who hears what is said about picking: the stage, which shows the start as its notice and says the end. */
let hearer: ((said: Said) => void) | null = null
/** The row's eyedropper, told when Shift+I asks while it is there. */
let keyListener: (() => void) | null = null
/** How many eyedroppers hide the pop-ups now: one ending as another starts leaves them hidden. */
let hiders = 0

/**
 * The eyedropper: picks a colour from the design and gives `onPick` its `#RRGGBB`, as typing that hex
 * where it sits would. Pressed again, by another press on the page, by Esc or by going from the
 * page, it stops with nothing picked. `fromKey` is the "In this design" row's, which Shift+I starts.
 * `look` is a colour field's square button, or a round one in a row of swatches.
 */
export function EyedropperButton({
  editor,
  name,
  onPick,
  fromKey = false,
  look = 'field',
}: {
  editor: Editor
  /** What it picks for, which its name says; without, it picks a colour. */
  name?: string
  onPick: (hex: string) => void
  fromKey?: boolean
  look?: 'field' | 'swatch'
}) {
  const t = useMessages().editor.eyedropper
  const [on, setOn] = useState(false)
  const phone = usePhone()
  const button = useRef<HTMLButtonElement>(null)
  const picks = useRef(onPick)
  const words = useRef(t)
  const picking = useRef(false)
  /** What it picks now, so the end of a pick it started again in its place changes nothing. */
  const current = useRef<Promise<string | null> | null>(null)
  useEffect(() => {
    picks.current = onPick
    words.current = t
  })
  const start = useCallback(
    (touch: boolean) => {
      hearer?.({ text: touch ? words.current.pickingTouch : words.current.picking, start: true })
      picking.current = true
      setOn(true)
      const pick = editor.pickColour()
      current.current = pick
      void pick.then((hex) => {
        if (current.current !== pick) return
        picking.current = false
        setOn(false)
        // Another eyedropper started picking in its place: it says its own start, and later its end.
        if (editor.picking()) return
        hearer?.({ text: hex ? format(words.current.picked, { hex }) : words.current.cancelled, start: false })
        if (hex) picks.current(hex)
      })
    },
    [editor],
  )
  // Going from the page stops what it picks.
  useEffect(
    () => () => {
      if (picking.current) editor.stopPicking()
    },
    [editor],
  )
  // Shift+I starts the row's, once it is there. A row shown again in that frame, as React's
  // development checks show it, starts again in its place.
  useEffect(() => {
    if (!fromKey) return
    const asked = () => {
      if (askedByKey.heard()) start(false)
    }
    keyListener = asked
    asked()
    return () => {
      if (keyListener === asked) keyListener = null
    }
  }, [fromKey, start])
  // On a phone the panel or pop-up it sits in stands over the stage: it is hidden while it picks. The
  // tap that picks ends with no click (the editor cancels its touchend), so it shows again at once.
  useEffect(() => {
    if (!on || !phone) return
    hidePopUps()
    return () => {
      showPopUps()
      // Hidden, it let the focus go to the page: it takes it back, so Esc closes the pop-up it is in.
      if (document.activeElement === document.body) button.current?.focus({ preventScroll: true })
    }
  }, [on, phone])
  const label = name ? format(t.pickFor, { name }) : t.pick
  return (
    <button
      ref={button}
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={on}
      data-testid="eyedropper"
      {...{ [KEEPS_PICKING]: '' }}
      onClick={(event) => {
        if (on) {
          editor.stopPicking()
          return
        }
        const native = event.nativeEvent as MouseEvent & { pointerType?: string }
        start(native.pointerType === 'touch')
      }}
      className={
        look === 'swatch'
          ? cn(SWATCH_TARGET, FOCUS_RING)
          : // 44 px on any touch screen, as the swatch beside it.
            cn(
              ICON_BUTTON,
              '[@media(hover:none)]:size-[44px]',
              FOCUS_RING,
              'aria-pressed:bg-accent-soft aria-pressed:text-accent-text',
            )
      }
    >
      {look === 'swatch' ? (
        <span
          aria-hidden
          className={cn(
            SWATCH_FACE,
            PANEL_SWATCH,
            'grid place-items-center border border-line-strong text-muted transition-colors group-hover/swatch:border-accent group-hover/swatch:text-text group-aria-pressed/swatch:border-accent group-aria-pressed/swatch:bg-accent-soft group-aria-pressed/swatch:text-accent-text',
          )}
        >
          <EyedropperIcon size={12} weight="bold" />
        </span>
      ) : (
        <EyedropperIcon size={14} aria-hidden />
      )}
    </button>
  )
}

/**
 * What Shift+I and Quick actions' Pick a colour do: stop picking while a colour is picked; else show
 * the colour whose "In this design" row picks, in the selection's Style while it has one
 * (`colourPickedIn`), or in the picked frame's Background switcher tab, and start that row's
 * eyedropper; with neither, nothing.
 */
export function pickFromPanel(editor: Editor) {
  if (editor.picking()) {
    editor.stopPicking()
    return
  }
  if (editor.readOnly()) {
    editor.tellViewOnly()
    return
  }
  const ids = editor.selection()
  if (ids.length > 0) {
    const design = editor.design()
    const target = targetOf(editor, ids, design)
    if (!target) return
    const facts = factsOf(target, design)
    const into = colourPickedIn({ kind: kindOf(target), facts, several: ids.length > 1, viewOnly: false })
    if (!into) return
    askedByKey.ask()
    // The font chooser or a card in the edit panel's place gives it back, showing Style.
    setOpen(null)
    pickSwitcherTab(into)
  } else {
    if (!editor.pickedFrame()) return
    askedByKey.ask()
    // The picked frame's panel gives back its place, or comes out from under a menu, showing Background.
    setOpen(null)
    pickSwitcherTab('background')
  }
  keyListener?.()
}

/**
 * What the page adds for picking a colour: Shift+I, and the live region that says how picking
 * ended. `onStart` shows the start as the stage's notice; `onEnd` takes that notice away.
 */
export function EyedropperChrome({
  editor,
  onStart,
  onEnd,
}: {
  editor: Editor
  onStart: (text: string) => void
  onEnd: () => void
}) {
  const [ended, setEnded] = useState('')
  const told = useRef({ onStart, onEnd })
  useEffect(() => {
    told.current = { onStart, onEnd }
  })
  useEffect(() => {
    hearer = (said) => {
      if (said.start) {
        setEnded('')
        told.current.onStart(said.text)
        return
      }
      told.current.onEnd()
      setEnded(said.text)
    }
    return () => {
      hearer = null
    }
  }, [])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // A text typed in, on the stage or in a field, types the capital I.
      if (event.defaultPrevented || event.repeat || composingKey(event) || shortcutFor(event) !== 'pickColour') return
      if (inField(event.target) || isStageField(event.target) || overPanel()) return
      event.preventDefault()
      pickFromPanel(editor)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editor])
  return (
    <p role="status" aria-atomic="true" data-testid="pick-said" className="sr-only">
      {ended}
    </p>
  )
}

/** Hides the panel and pop-ups over a phone's stage while a colour is picked, and their sheets with them. */
function hidePopUps() {
  hiders += 1
  document.documentElement.setAttribute(HIDES_POPUPS, '')
  hideSheets(true)
}

/** Shows the panel and pop-ups again once picking has ended, unless another eyedropper picks now. */
function showPopUps() {
  hiders -= 1
  if (hiders > 0) return
  document.documentElement.removeAttribute(HIDES_POPUPS)
  hideSheets(false)
}
