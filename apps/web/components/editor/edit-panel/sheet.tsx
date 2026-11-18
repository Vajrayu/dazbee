'use client'

// The edit panel's form on a stage narrower than EDIT_SHEET_WIDTH, a phone's or a tablet's: a sheet
// at the bottom with a handle, low or full (`sheet-heights.ts`). Its top edge is published, so the
// stage keeps the selection clear of it. On a phone it waits for an open flyout to close, as
// both rest above the tab bar, and full it hides the tab bar and closes the flyouts, as a sheet does.
import { type CSSProperties, type RefObject, useCallback, useLayoutEffect } from 'react'

import { setFullSheet, useEditState } from '@/components/editor/edit-store.ts'
import { EDIT_PANEL_INSET } from '@/components/editor/stage-insets.ts'
import { FOCUS_RING } from '@/components/ui/looks.ts'
import { useSheet } from '@/components/ui/sheet-top.ts'
import { cn } from '@/lib/cn.ts'
import { useMessages } from '@/lib/i18n/client.tsx'
import { usePhone } from '@/lib/phone.ts'

import { LOW_SHARE, useEditSheet, useSheetDrag } from './sheet-heights.ts'

/**
 * The sheet's card: across a phone, and on a tablet from EDIT_PANEL_INSET from the start edge, or
 * past an open flyout (`--sheet-start`), to EDIT_PANEL_INSET from the end edge. Its height and place glide between low
 * and full.
 */
const SHEET_CARD = cn(
  'inset-x-2 rounded-[22px] sm:start-(--sheet-start) sm:end-(--edit-panel-inset)',
  'transition-[max-height,bottom] duration-[var(--chrome)] ease-(--ease-out) motion-reduce:transition-none',
)
/** Low, above the phone's tab bar, or the tablet's zoom pill and Pages, at most LOW_SHARE of the stage tall. */
const LOW_SHEET = 'bottom-(--above-tab-bar) sm:bottom-(--above-corner)'
/** Full, up to the panel's top, and on a phone over the tab bar's place. */
const FULL_SHEET =
  'bottom-2 max-h-[calc(100%-var(--panel-top)-0.5rem)] sm:bottom-(--above-corner) sm:max-h-[calc(100%-var(--panel-top)-var(--above-corner))]'
/**
 * A card in the edit panel's place as a sheet, as the font chooser is: on a phone over the tab bar's
 * place, and on a tablet where the edit panel's sheet rests, at most 46 % of the stage tall.
 */
export const FRAME_SHEET =
  'top-auto bottom-2 max-h-[46%] rounded-[22px] sm:bottom-(--above-corner) sm:start-(--sheet-start) sm:end-(--edit-panel-inset) sm:w-auto sm:max-lg:max-h-[46%]'

/**
 * The edit panel as a sheet, while the stage is narrower than EDIT_SHEET_WIDTH (`on`): whether it
 * is full, whether it waits for a phone's flyout to close, the card's ref, which fills `panel` and
 * publishes its top edge, the drag of its handle, and its card's classes and style. `panel` is the
 * card, `body` its part that scrolls, and `top` how far down the stage the full sheet reaches.
 */
export function useSelectionSheet(
  panel: RefObject<HTMLElement | null>,
  body: RefObject<HTMLElement | null>,
  top: number,
) {
  const { sheetHeight, flyout } = useEditState()
  const start = useSheetStart()
  const phone = usePhone()
  const on = useEditSheet()
  const full = on && sheetHeight === 'full'
  const waits = phone && flyout !== null
  const publish = useSheet(on && !waits)
  const ref = useCallback(
    (element: HTMLElement | null) => {
      panel.current = element
      publish(element)
    },
    [panel, publish],
  )
  const drag = useSheetDrag(panel, body, top)
  useLayoutEffect(() => {
    if (!full || waits) return
    setFullSheet(true)
    return () => setFullSheet(false)
  }, [full, waits])
  const height: CSSProperties =
    drag.dragged !== null
      ? // As tall as the drag makes it, following the finger.
        { maxHeight: drag.dragged, transition: 'none' }
      : full
        ? {}
        : { maxHeight: `${LOW_SHARE * 100}%` }
  return {
    on,
    full,
    waits,
    ref,
    handle: drag.handle,
    className: on ? cn(SHEET_CARD, full ? FULL_SHEET : LOW_SHEET) : null,
    style: on ? { ...start, ...height } : {},
  }
}

/** Where a tablet's sheet starts (`--sheet-start`): as far in as it ends, or past an open flyout. */
export function useSheetStart() {
  const { flyoutEnd } = useEditState()
  return { '--sheet-start': `${(flyoutEnd ?? 0) + EDIT_PANEL_INSET}px` } as CSSProperties
}

/**
 * The sheet's handle: a grip at its top, whose target is a finger's, 44 px tall, reaching over the
 * header's middle. It drags the sheet, and a press, Enter or Space takes it to the other height.
 */
export function SheetHandle({ full, handle }: { full: boolean; handle: ReturnType<typeof useSheetDrag>['handle'] }) {
  const t = useMessages()
  return (
    <div className="relative h-4 shrink-0">
      <button
        type="button"
        aria-label={full ? t.editor.editPanel.showLess : t.editor.editPanel.showAll}
        aria-expanded={full}
        data-testid="sheet-handle"
        {...handle}
        className={cn(
          'group/handle absolute start-1/2 top-0 z-10 flex h-[44px] w-24 -translate-x-1/2 cursor-grab touch-none justify-center rounded-full active:cursor-grabbing rtl:translate-x-1/2',
          FOCUS_RING,
        )}
      >
        <span
          aria-hidden
          className="mt-2 h-1 w-9 rounded-full bg-line-strong transition-colors duration-[var(--chrome-fast)] group-hover/handle:bg-subtle group-active/handle:bg-muted"
        />
      </button>
    </div>
  )
}
