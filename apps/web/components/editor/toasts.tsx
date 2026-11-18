'use client'

import { type CSSProperties, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { type Editor, HANDLE_SIZE } from '@dazbee/editor'
import type { Rect } from '@dazbee/schema'

import { Button } from '@/components/ui/button.tsx'
import { InfoIcon, TrashIcon } from '@/components/ui/icons.tsx'
import { TOUCH_FIELD } from '@/components/ui/looks.ts'
import { Mascot, type MascotPose } from '@/components/ui/mascot.tsx'
import { sheetsHidden, sheetTop, useSheetsHidden, useSheetTop } from '@/components/ui/sheet-top.ts'
import { cn } from '@/lib/cn.ts'
import { watchOnly } from '@/lib/editor/watch-boxes.ts'
import { useMessages } from '@/lib/i18n/client.tsx'

import { CHROME } from './chrome.ts'
import { useEditState } from './edit-store.ts'
import { TOAST } from './styles.ts'

const TOAST_MS = 8000
/** The room a toast keeps from a control beside it, and from what it sits above. */
const GAP = 8

/**
 * Where a toast sits: its distance from the stage's bottom edge, in pixels. It starts where its slot
 * rests, `rest`, and stays there unless that covers a control, `controls`; then it rises above it.
 * It keeps off each box of `rather` too, in turn (a phone's open sheet, then the selection), while
 * it still fits on the stage above it; where it doesn't, it covers that box as it would without it.
 */
function toastBottom(stage: DOMRect, rest: DOMRect, controls: DOMRect[], rather: (DOMRect | null)[]) {
  let kept = controls
  let bottom = riseAbove(stage, rest, kept)
  for (const box of rather) {
    if (!box) continue
    const above = riseAbove(stage, rest, [...kept, box])
    if (stage.bottom - above - rest.height < stage.top) continue
    kept = [...kept, box]
    bottom = above
  }
  return bottom
}

/**
 * How far above the stage's bottom edge a toast resting at `rest` sits clear of `boxes`: where it
 * covers one it rises above it, lowest first, so it is then checked against those above.
 */
function riseAbove(stage: DOMRect, rest: DOMRect, boxes: DOMRect[]) {
  let bottom = stage.bottom - rest.bottom
  for (const box of [...boxes].sort((a, b) => b.top - a.top)) {
    const top = stage.bottom - bottom - rest.height
    const beside = box.right + GAP <= rest.left || box.left - GAP >= rest.right
    if (!beside && box.top < stage.bottom - bottom + GAP && box.bottom > top - GAP)
      bottom = Math.max(bottom, stage.bottom - box.top + GAP)
  }
  return bottom
}

/**
 * The selection's box on screen, `rect` in the stage's pixels, with its handles, which reach half
 * their size past it.
 */
function withHandles(stage: DOMRect, rect: Rect) {
  const reach = HANDLE_SIZE / 2
  return new DOMRect(
    stage.left + rect.x - reach,
    stage.top + rect.y - reach,
    rect.width + 2 * reach,
    rect.height + 2 * reach,
  )
}

/**
 * Holds the toast over the stage, the one place every toast is placed: at the bottom start, past an
 * open flyout, beside the dock when it fits, above the chrome it would cover when it doesn't,
 * above a phone's open sheet (but one hidden while a colour is picked), and above the selection and
 * its handles. Its class sets where it rests; it reads the chrome's boxes on screen as they are now,
 * so it follows them as they change, and the selection as each frame is drawn, so it follows it as
 * it or the view moves.
 */
export function ToastSlot({ editor, children }: { editor: Editor | null; children: ReactNode }) {
  const { flyoutEnd } = useEditState()
  // A sheet opening, growing, closing, hiding or showing again renders the slot again, which places it.
  useSheetTop()
  useSheetsHidden()
  const shown = Boolean(children)
  const slot = useRef<HTMLDivElement>(null)
  // Places the slot: on the element itself, so it is in place before the frame is drawn, never a
  // frame later. Set while a toast shows.
  const place = useRef<(() => void) | null>(null)
  useLayoutEffect(() => {
    const el = slot.current
    if (!shown || !el) return
    const stage = el.offsetParent
    if (!stage) return
    // Each element whose size places the slot: the slot, the stage and the chrome on the page now.
    const watched = new Set<Element>()
    const watch = new ResizeObserver(() => place.current?.())
    // What places the slot as last measured: the stage, where the slot rests, the controls shown and
    // the open sheet, all in the window's pixels. They change only as the page lays out again.
    let measured: { room: DOMRect; rest: DOMRect; controls: DOMRect[]; sheet: DOMRect | null } | null = null
    // The selection's box and the slot's distance from the stage's bottom, as it was last placed.
    let selected = ''
    let bottom = ''
    // Places the slot from what was measured and the selection now, writing only a new distance.
    const settle = () => {
      if (!measured) return
      const { room, rest, controls, sheet } = measured
      const rect = editor?.selectionRect() ?? null
      selected = JSON.stringify(rect)
      const at = `${toastBottom(room, rest, controls, [sheet, rect && withHandles(room, rect)])}px`
      if (at === bottom) return
      bottom = at
      el.style.bottom = at
    }
    place.current = () => {
      const chrome = [...document.querySelectorAll(CHROME.join(', '))]
      watchOnly(watch, watched, [el, stage, ...chrome])
      // Where the slot rests, as its class sets it.
      el.style.bottom = ''
      bottom = ''
      const room = stage.getBoundingClientRect()
      // A sheet hidden while a colour is picked from the stage under it is no sheet.
      const top = sheetsHidden() ? null : sheetTop()
      measured = {
        room,
        rest: el.getBoundingClientRect(),
        controls: chrome
          .filter((c) => c.checkVisibility({ visibilityProperty: true }))
          .map((c) => c.getBoundingClientRect()),
        sheet: top === null ? null : new DOMRect(room.left, top, room.width, room.bottom - top),
      }
      settle()
    }
    // Placed again as a frame is drawn with the selection elsewhere: it moved, or the view did.
    const stopDraws = editor?.onDraw(() => {
      if (JSON.stringify(editor.selectionRect()) !== selected) settle()
    })
    return () => {
      stopDraws?.()
      watch.disconnect()
      place.current = null
    }
  }, [shown, editor])
  // Placed after every render while a toast shows: a new toast, a flyout opening, or a control
  // shown or hidden.
  useLayoutEffect(() => place.current?.())
  return (
    <div
      data-toasts
      ref={slot}
      // Past an open flyout, as far from it as from the stage's start without one.
      style={flyoutEnd === null ? undefined : ({ '--flyout-end': `${flyoutEnd}px` } as CSSProperties)}
      className="pointer-events-none absolute start-[calc(var(--flyout-end,0px)+1rem)] bottom-4 z-30 max-w-[calc(100%-var(--flyout-end,0px)-2rem)]"
    >
      {children}
    </div>
  )
}

/** After a page or a frame is deleted: says so, with undo, for a few seconds. */
export function UndoToast({ editor, message, onDone }: { editor: Editor; message: string; onDone: () => void }) {
  const t = useMessages()
  // It stays while the pointer or focus is on it, so the undo can't vanish from under a click.
  const [held, setHeld] = useState(false)
  useEffect(() => {
    if (held) return
    const timer = setTimeout(onDone, TOAST_MS)
    return () => clearTimeout(timer)
  }, [message, onDone, held])
  return (
    <div
      role="status"
      data-testid="removed-toast"
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
      className={TOAST}
    >
      <TrashIcon size={14} aria-hidden className="text-subtle" />
      <span>{message}</span>
      <Button
        variant="ghost"
        className="h-7 px-2.5 text-tiny font-semibold text-accent-text"
        onClick={() => {
          editor.session.undo()
          onDone()
        }}
      >
        {t.editor.actions.undo}
      </Button>
    </div>
  )
}

/**
 * Says why a gesture did nothing, such as a nudge auto layout decides; it goes after a few seconds.
 * A `lasting` one, such as files uploading, stays until its message changes or it is taken away.
 * An `action`, such as Reload, is a button beside the words. A `pose` shows Daz, 48 px, in place of
 * the info sign.
 */
export function NoticeToast({
  message,
  onDone,
  lasting = false,
  action,
  pose,
}: {
  message: string
  onDone: () => void
  lasting?: boolean
  action?: { label: string; run: () => void }
  pose?: MascotPose
}) {
  useEffect(() => {
    if (lasting) return
    const timer = setTimeout(onDone, TOAST_MS)
    return () => clearTimeout(timer)
  }, [message, onDone, lasting])
  return (
    <div role="status" data-testid="notice-toast" className={cn(TOAST, !action && 'pe-3.5', pose && 'ps-1.5')}>
      {pose ? <Mascot pose={pose} size={48} /> : <InfoIcon size={14} aria-hidden className="shrink-0 text-subtle" />}
      <span>{message}</span>
      {action && (
        <Button
          variant="ghost"
          className={`h-7 ${TOUCH_FIELD} shrink-0 px-2.5 text-tiny font-semibold text-accent-text`}
          onClick={action.run}
        >
          {action.label}
        </Button>
      )}
    </div>
  )
}
