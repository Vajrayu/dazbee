'use client'

// The edit panel as a sheet at the bottom of a stage narrower than EDIT_SHEET_WIDTH, on a phone or
// a tablet: its two heights, low (its first rows, at most LOW_SHARE of the stage) and full (all of
// it, up to the panel's top), and the drag of its handle between them. A drag follows the finger
// and settles on the height it is nearer, or the way a flick goes; a press on the handle without a
// drag, or Enter or Space on it, goes to the other height.
import { type PointerEvent as ReactPointerEvent, type RefObject, useLayoutEffect, useRef, useState } from 'react'

import { pastSlop } from '@dazbee/editor/press'

import { setSheetHeight, type SheetHeight, useEditState } from '@/components/editor/edit-store.ts'
import { EDIT_SHEET_WIDTH } from '@/components/editor/stage-insets.ts'

/** A drag of the handle under way: where it started, the sheet's heights, and its last moves. */
type Drag = {
  pointer: number
  pointerType: string
  x: number
  y: number
  from: number
  low: number
  full: number
  moved: boolean
  /** The pointer's height down the screen at each move, with its time, for the speed at the end. */
  trail: { y: number; at: number }[]
}

/** The most of the stage's height the low sheet takes. */
export const LOW_SHARE = 0.4

/** How fast a drag ends for it to count as a flick, in pixels a millisecond. */
const FLICK = 0.5
/** How long before the drag's end its speed is measured over, in milliseconds. */
const SPEED_SPAN = 80
/** The stages the edit panel is a sheet on. */
const SHEET_QUERY = `(width < ${EDIT_SHEET_WIDTH}px)`

/**
 * The height a drag leaves the sheet at, from how tall it is (`at`) and how fast it was changing
 * as the finger let go (`speed`, in pixels a millisecond, growing above 0): the way a flick goes,
 * else the height it is nearer. Low while the whole sheet shows low already.
 */
export function snapHeight({
  low,
  full,
  at,
  speed,
}: {
  low: number
  full: number
  at: number
  speed: number
}): SheetHeight {
  if (full <= low) return 'low'
  if (Math.abs(speed) >= FLICK) return speed > 0 ? 'full' : 'low'
  return at - low > full - at ? 'full' : 'low'
}

/** How tall the sheet is while its handle is dragged `by` pixels down from where it went down at height `from`, kept between low and full. */
export function draggedHeight({ low, full, from, by }: { low: number; full: number; from: number; by: number }) {
  return Math.min(Math.max(low, full), Math.max(low, from - by))
}

/**
 * Whether the edit panel is a sheet at the bottom: on a stage narrower than EDIT_SHEET_WIDTH, a
 * tablet's or a phone's. Read as the caller first renders, so a sheet never first shows, and grows
 * from, the side panel's place.
 */
export function useEditSheet() {
  const [sheet, setSheet] = useState(() => typeof window !== 'undefined' && window.matchMedia(SHEET_QUERY).matches)
  useLayoutEffect(() => {
    const query = window.matchMedia(SHEET_QUERY)
    const update = () => setSheet(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return sheet
}

/**
 * The drag of the sheet's handle: the handle's pointer and click handlers, and the sheet's height
 * while it is dragged (null otherwise). `card` is the sheet, `body` its part that scrolls, and
 * `top` how far down the stage the full sheet may reach.
 */
export function useSheetDrag(card: RefObject<HTMLElement | null>, body: RefObject<HTMLElement | null>, top: number) {
  const { sheetHeight } = useEditState()
  const [dragged, setDragged] = useState<number | null>(null)
  const drag = useRef<Drag | null>(null)
  // Whether the click that follows a drag's end is the drag's own, which changes nothing more.
  const dragEnded = useRef(false)
  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    const sheet = card.current
    const stage = sheet?.offsetParent
    if (!sheet || !(stage instanceof HTMLElement) || event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    // All of the sheet's rows, including those its body scrolls to.
    const content = sheet.offsetHeight + (body.current ? body.current.scrollHeight - body.current.clientHeight : 0)
    // The full sheet's top stays where the drag can take it: at the panel's top.
    const reach = sheet.getBoundingClientRect().bottom - stage.getBoundingClientRect().top - top
    dragEnded.current = false
    drag.current = {
      pointer: event.pointerId,
      pointerType: event.pointerType,
      x: event.clientX,
      y: event.clientY,
      from: sheet.offsetHeight,
      low: Math.min(content, stage.clientHeight * LOW_SHARE),
      full: Math.min(content, reach),
      moved: false,
      trail: [{ y: event.clientY, at: event.timeStamp }],
    }
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const now = drag.current
    if (!now || now.pointer !== event.pointerId) return
    if (!now.moved && !pastSlop(now, { x: event.clientX, y: event.clientY }, now.pointerType)) return
    now.moved = true
    now.trail = [
      ...now.trail.filter((one) => event.timeStamp - one.at <= SPEED_SPAN),
      { y: event.clientY, at: event.timeStamp },
    ]
    setDragged(draggedHeight({ ...now, by: event.clientY - now.y }))
  }
  const onPointerEnd = (event: ReactPointerEvent<HTMLElement>) => {
    const now = drag.current
    if (!now || now.pointer !== event.pointerId) return
    drag.current = null
    setDragged(null)
    if (!now.moved) return
    dragEnded.current = true
    const first = now.trail[0]
    const last = now.trail.at(-1)
    const speed = first && last && last.at > first.at ? (first.y - last.y) / (last.at - first.at) : 0
    // Where the finger last moved, as a cancelled pointer's own place may be gone.
    const at = draggedHeight({ ...now, by: (last?.y ?? now.y) - now.y })
    setSheetHeight(snapHeight({ low: now.low, full: now.full, at, speed }))
  }
  const onClick = () => {
    if (dragEnded.current) {
      dragEnded.current = false
      return
    }
    setSheetHeight(sheetHeight === 'low' ? 'full' : 'low')
  }
  return {
    dragged,
    handle: { onPointerDown, onPointerMove, onPointerUp: onPointerEnd, onPointerCancel: onPointerEnd, onClick },
  }
}
