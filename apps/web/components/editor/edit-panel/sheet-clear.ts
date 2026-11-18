// Where the edit panel is a sheet at the bottom, on a phone or a tablet, the stage glides the least
// to keep the selection clear of the low sheet, or of a sheet in the panel's place, and a crop clear
// of the low sheet whole; and the presses, drags, wheel turns and keys the page has heard, which tell
// whether the person has acted since the move was asked for.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import type { Editor, Insets } from '@dazbee/editor'
import { pastSlop } from '@dazbee/editor/press'
import type { Rect } from '@dazbee/schema'

import {
  editState,
  isMenuSheet,
  isPanel,
  setSheetHeight,
  type SheetHeight,
  useEditState,
} from '@/components/editor/edit-store.ts'
import { sheetsHidden, sheetTop, useSheetsHidden, useSheetTop } from '@/components/ui/sheet-top.ts'

/** The selection as it was made: how many acts the page had heard, and whether a press made it. */
type Made = { acts: number; byPress: boolean }

/** The crop being made, as the overlay draws it: its window, and the whole image round it. */
const CROPPING = '.stage-overlay :is([data-cropping], .crop-image)'
/** Room kept between a sheet and what the stage moves clear of it, in pixels. */
const CLEAR = 12
/** How long after a tap a second tap still makes a double tap, in milliseconds. */
const DOUBLE_TAP = 400

/**
 * When the last press on the page went down, where and by what pointer type, whether it is held,
 * has become a drag (once past the stage's slop for its pointer type, as a press on the stage does)
 * or is a double tap's second, when it went up, and how many presses, drags, wheel turns and keys
 * the page has heard, as window listeners keep them; a double tap's second press is not counted as
 * a press, being the same tap's.
 */
export const press = {
  at: 0,
  x: 0,
  y: 0,
  pointerType: 'mouse',
  held: false,
  dragged: false,
  second: false,
  upAt: 0,
  acts: 0,
}

/**
 * The stage's bottom edge a sheet over it covers, CLEAR past its top edge (`sheetAt`, in the
 * window's pixels, as `sheetTop` gives it), for the stage at `stage`, while it covers `rect`, in the
 * stage's pixels: none for a part it leaves clear, with no sheet open, for the edit panel's sheet at
 * its full height, which the person dragged up to see all of it, or for a menu's sheet, which acts
 * and closes.
 */
export function sheetCover(
  stage: { top: number; bottom: number },
  sheetAt: number | null,
  state: { open: string | null; rightClick: boolean; sheetHeight: SheetHeight },
  rect: Rect,
): Partial<Insets> | null {
  if (sheetAt === null || isMenuSheet(state)) return null
  if (state.sheetHeight === 'full' && !isPanel(state.open)) return null
  const bottom = stage.bottom - sheetAt + CLEAR
  return rect.y + rect.height > stage.bottom - stage.top - bottom ? { bottom } : null
}

/**
 * Where the edit panel is a sheet (`on`), glides the stage the least to keep the selection clear of
 * the low sheet, or of a sheet in the panel's place such as the font chooser, at the same zoom; a
 * selection too tall for the room above it shows from its top. While a photo is cropped, the sheet
 * goes low and the stage glides to show the whole image clear of it, zoomed out as far as it needs,
 * so every crop handle can be reached. It asks again whenever the selection or the sheet's top
 * changes, and as a crop starts or ends. For a selection made by a press, it waits until the press
 * has ended and a second tap can no longer make it a double tap, or until the stage has heard a
 * double tap, so a text double-tapped to type in stays where the first tap found it. Nothing moves
 * once the person has acted since it asked, with another press, a drag, a wheel or a key, so a
 * zoom, a pan, a drag or typing is never followed by a move it didn't ask for.
 */
export function useSheetClear(editor: Editor, ids: string[], on: boolean) {
  const key = ids.join(' ')
  const { open, rightClick, sheetHeight } = useEditState()
  // Where the open sheet starts, which the selection is kept clear of, and whether the sheets are hidden.
  const sheetAt = useSheetTop()
  const hidden = useSheetsHidden()
  // The selection as it was made.
  const made = useRef<Made>({ acts: 0, byPress: false })
  const [cropping, setCropping] = useState(false)
  useEffect(() => {
    const mark = () => {
      made.current = { acts: press.acts, byPress: press.held }
    }
    mark()
    const stopSelection = editor.onSelection(mark)
    const stopShown = editor.onShown(() => setCropping(document.querySelector(CROPPING) !== null))
    return () => {
      stopSelection()
      stopShown()
    }
  }, [editor])
  useEffect(() => {
    if (on && cropping) setSheetHeight('low')
  }, [on, cropping])
  useLayoutEffect(() => {
    if (!on || key === '' || hidden) return
    const asked = press.acts
    const clear = () => {
      if (press.held || press.acts !== asked) return
      const overlay = document.querySelector<HTMLElement>('.stage-overlay')
      const crop = cropRect()
      const rect = crop ?? editor.selectionRect()
      if (!overlay || !rect) return
      const cover = sheetCover(overlay.getBoundingClientRect(), sheetsHidden() ? null : sheetTop(), editState(), rect)
      if (cover) editor.showOnStage(rect, cover, crop !== null)
    }
    // Only the press that made the selection waits for a second tap.
    const tapping = () => made.current.byPress && made.current.acts === press.acts
    let timer = 0
    const later = () => {
      const left = tapping() ? doubleTapLeft() : 0
      if (left > 0) timer = window.setTimeout(later, left)
      else clear()
    }
    if (press.held) window.addEventListener('pointerup', later, { once: true })
    else later()
    window.addEventListener('dblclick', clear)
    return () => {
      window.removeEventListener('pointerup', later)
      window.removeEventListener('dblclick', clear)
      clearTimeout(timer)
    }
  }, [editor, key, on, hidden, sheetAt, cropping, open, rightClick, sheetHeight])
}

/**
 * Keeps `press` as presses go down, move and go up, wheels turn and keys go down anywhere on the
 * page, before anything else hears them.
 */
export function usePressWatch() {
  useEffect(() => {
    const down = (event: PointerEvent) => pressDown(event)
    const move = (event: PointerEvent) => pressMove(event)
    const up = () => {
      press.held = false
      press.upAt = performance.now()
    }
    const act = () => {
      press.acts++
    }
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerup', up, true)
    window.addEventListener('pointercancel', up, true)
    window.addEventListener('wheel', act, true)
    window.addEventListener('keydown', act, true)
    return () => {
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('pointercancel', up, true)
      window.removeEventListener('wheel', act, true)
      window.removeEventListener('keydown', act, true)
    }
  }, [])
}

/** Keeps a press going down in `press`: when, where, by what pointer type, and whether it is a double tap's second. */
export function pressDown(event: Pick<PointerEvent, 'clientX' | 'clientY' | 'pointerType'>) {
  // A press soon after a tap that didn't drag is that tap's second, as a double tap's is.
  const second = !press.held && !press.dragged && !press.second && doubleTapLeft() > 0
  Object.assign(press, {
    at: performance.now(),
    x: event.clientX,
    y: event.clientY,
    pointerType: event.pointerType,
    held: true,
    dragged: false,
    second,
  })
  if (!second) press.acts++
}

/**
 * Keeps a move of the press held in `press`: it becomes a drag once it goes past the stage's slop
 * for its pointer type from where it went down, as a press on the stage does.
 */
export function pressMove(event: Pick<PointerEvent, 'clientX' | 'clientY'>) {
  const at = { x: event.clientX, y: event.clientY }
  if (!press.held || press.dragged || !pastSlop({ x: press.x, y: press.y }, at, press.pointerType)) return
  press.dragged = true
  press.acts++
}

/**
 * How long until a second tap can no longer make the last press a double tap, in milliseconds:
 * the whole time while the press is held, and none once a double tap's second press is up.
 */
function doubleTapLeft() {
  if (press.held) return DOUBLE_TAP
  return press.second ? 0 : Math.max(0, press.upAt + DOUBLE_TAP - performance.now())
}

/**
 * Where the crop being made is drawn, in the stage's pixels: the window and the whole image round
 * it, as the overlay draws them; null while nothing is cropped.
 */
function cropRect(): Rect | null {
  const overlay = document.querySelector('.stage-overlay')
  const parts = [...document.querySelectorAll(CROPPING)]
  if (!overlay || parts.length === 0) return null
  const stage = overlay.getBoundingClientRect()
  const boxes = parts.map((part) => part.getBoundingClientRect())
  const left = Math.min(...boxes.map((box) => box.left))
  const top = Math.min(...boxes.map((box) => box.top))
  const right = Math.max(...boxes.map((box) => box.right))
  const bottom = Math.max(...boxes.map((box) => box.bottom))
  return { x: left - stage.left, y: top - stage.top, width: right - left, height: bottom - top }
}
