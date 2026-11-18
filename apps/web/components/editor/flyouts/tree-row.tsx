'use client'

// The pieces the rows of the layers panel's tree share, and the frame stepper above them: the calls
// a row makes on the panel, its height on this screen, its look and place in the list, and its caret.
// The sizes along a row's start are numbers here, which the rows' styles and the mask arrows both read.
import { type DragEvent, type KeyboardEvent, type MouseEvent, useEffect, useState } from 'react'

import { CaretRightIcon } from '@/components/ui/icons.tsx'
import { cn } from '@/lib/cn.ts'
import type { ClickKeys, Row } from '@/lib/editor/layer-tree.ts'
import { useMessages } from '@/lib/i18n/client.tsx'
import { format } from '@/lib/i18n/index.ts'

export type Where = 'above' | 'below' | 'into'

export interface RowApi {
  focus: (id: string) => void
  key: (event: KeyboardEvent<HTMLElement>, row: Row, i: number) => void
  click: (id: string, keys: ClickKeys) => void
  rename: (id: string) => void
  renamed: (id: string, name: string | null, before: string, byKey: boolean) => void
  toggle: (id: string) => void
  lock: (id: string, locked: boolean) => void
  hide: (id: string, hidden: boolean) => void
  dragStart: (id: string) => void
  dragEnd: () => void
  dragOver: (event: DragEvent<HTMLElement>, row: Row) => boolean
  dragLeave: (id: string) => void
  drop: (event: DragEvent<HTMLElement>, row: Row) => boolean
  /** The row under the pointer, whose layer the stage outlines; null once the pointer leaves it. */
  hover: (row: Row | null) => void
}

/** A row's height in pixels: every row is the same, which is what lets only the rows in view render. */
export const LAYER_ROW = 36
/**
 * A row's height on a phone or a touch screen: a pill 50 px tall holding 44 px targets, 8 px from
 * the next row's.
 */
export const ROOMY_ROW = 52
/** How much deeper each level of the tree starts, in pixels. */
export const INDENT = 16
/** A row's inset from each side of the tree. */
export const ROW_INSET = 4
/** A row's start padding before its depth's indent. */
export const ROW_PAD = 4
/** A row's caret, as drawn, and its tap area on a phone or a touch screen. */
export const CARET = 16
export const CARET_TAP = 44
/** The gap between a row's caret, picture, name and end. */
export const ROW_GAP = 6
/** A row's picture or icon tile. */
export const PICTURE = 22
/** A row's look: a pill, its focus ring inset; its place, inset, gap and start padding are in `rowPlace`. */
export const ROW_LOOK =
  'group absolute flex cursor-default items-center rounded-[8px] pe-1 text-small outline-none select-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset'
/** A selected layer's row, and the picked frame's name in the stepper, are tinted pink, as in the mock. */
export const ROW_SELECTED = 'bg-accent/20 text-text lit'
/** A row's end label in mono, at the row's end: Mask, a box's kind, "only here"; and the stepper's frame size. */
export const ROW_LABEL = 'shrink-0 font-mono text-caption text-subtle'
/** The screens whose rows are roomy: a phone's, and any a finger works without hover. */
const ROOMY_SCREENS = '(max-width: 639px), (hover: none)'
/** The screens a finger works without hover. */
const TOUCH_SCREENS = '(hover: none)'

/** Where a row sits: its place in the list and its start padded by its depth, 2 px apart so each selected row reads as its own pill. */
export const rowPlace = (i: number, depth: number, pitch = LAYER_ROW) => ({
  top: i * pitch + 1,
  height: pitch - 2,
  insetInlineStart: ROW_INSET,
  insetInlineEnd: ROW_INSET,
  gap: ROW_GAP,
  paddingInlineStart: ROW_PAD + depth * INDENT,
})

/** How far from the tree's top the middle of row `i` is. */
export const rowMiddle = (i: number, pitch = LAYER_ROW) => i * pitch + pitch / 2

/** How far from the tree's start edge the middle of a row's picture is, at a depth. */
export const pictureMiddle = (depth: number) => ROW_INSET + ROW_PAD + depth * INDENT + CARET + ROW_GAP + PICTURE / 2

/** The keys a click or a key on a row was made with. */
export const keysOf = (event: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }): ClickKeys => ({
  shift: event.shiftKey,
  mod: event.metaKey || event.ctrlKey,
})

/**
 * The handlers every row of the tree has: taking the focus, its keys, a click that selects it (with
 * Ctrl or Cmd adding to the selection or taking from it, and Shift selecting the rows from the last
 * one clicked), a double click that renames it, and a layer dragged over, off or dropped on it.
 */
export function rowHandlers(api: RowApi, row: Row, i: number) {
  return {
    onFocus: () => api.focus(row.id),
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => api.key(event, row, i),
    onClick: (event: MouseEvent<HTMLElement>) => api.click(row.id, keysOf(event)),
    onDoubleClick: () => api.rename(row.id),
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (!api.dragOver(event, row)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
    },
    onDragLeave: () => api.dragLeave(row.id),
    onDrop: (event: DragEvent<HTMLElement>) => {
      if (api.drop(event, row)) event.preventDefault()
    },
    onPointerEnter: () => api.hover(row),
    onPointerLeave: () => api.hover(null),
  }
}

/** The rows' height on this screen: ROOMY_ROW on a phone or a touch screen, else LAYER_ROW. */
export function useRowPitch() {
  return useMatches(ROOMY_SCREENS) ? ROOMY_ROW : LAYER_ROW
}

/** Whether this screen is one a finger works without hover. */
export function useTouchScreen() {
  return useMatches(TOUCH_SCREENS)
}

/** Whether a media query matches this screen, kept up to date. */
function useMatches(media: string) {
  const [matches, setMatches] = useState(false)
  useEffect(() => {
    const query = window.matchMedia(media)
    const update = () => setMatches(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [media])
  return matches
}

/** A row's caret, which opens and closes it and never renames it; an empty space of its size on a row with nothing inside. */
export function RowCaret({
  shown,
  open,
  name,
  onToggle,
}: {
  shown: boolean
  open: boolean
  name: string
  onToggle: () => void
}) {
  const t = useMessages()
  const size = { width: CARET, height: CARET }
  if (!shown) return <span aria-hidden className="shrink-0" style={size} />
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={format(open ? t.editor.layersPanel.collapse : t.editor.layersPanel.expand, { name })}
      onClick={(event) => {
        event.stopPropagation()
        onToggle()
      }}
      // Two clicks open and close the row; their double click never reaches it to rename.
      onDoubleClick={(event) => event.stopPropagation()}
      style={size}
      // Above the picture, so a tap where its tap area overlaps the picture opens or closes the row.
      className="relative z-[1] grid shrink-0 cursor-pointer place-items-center rounded-row text-subtle hover:text-text"
    >
      {/* On a phone or a touch screen, a tap area a finger can hit, centred on the caret as drawn. */}
      <span
        aria-hidden
        data-testid="caret-tap"
        className="absolute hidden max-sm:block [@media(hover:none)]:block"
        style={{ inset: (CARET - CARET_TAP) / 2 }}
      />
      <CaretRightIcon
        size={11}
        weight="bold"
        aria-hidden
        className={cn(
          'transition-transform duration-[var(--chrome-fast)] rtl:-scale-x-100',
          open && 'rotate-90 rtl:-rotate-90',
        )}
      />
    </button>
  )
}
