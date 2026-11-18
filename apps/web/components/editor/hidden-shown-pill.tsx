'use client'

// The pill at the top of the stage while the hidden layers show: it says so, and Hide them stops
// showing them, leaving them hidden. It sits under the islands, between the open flyout and the edit
// panel's place, and gives way to a phone's sheet that reaches up to it.
import { useLayoutEffect, useRef, useState } from 'react'

import type { Editor } from '@dazbee/editor'

import { Button } from '@/components/ui/button.tsx'
import { EyeSlashIcon } from '@/components/ui/icons.tsx'
import { TOUCH_FIELD } from '@/components/ui/looks.ts'
import { sheetTopIn, useSheetTop } from '@/components/ui/sheet-top.ts'
import { useLocale, useMessages } from '@/lib/i18n/client.tsx'
import { dirOf } from '@/lib/i18n/index.ts'

import { useEditState } from './edit-store.ts'
import { useHiddenShown } from './editor-hooks.ts'
import type { ChromeInsets } from './stage-insets.ts'
import { TOAST } from './styles.ts'

/** The pill's height, and the room it keeps from a sheet below it, in pixels. */
const PILL_ROOM = 56

/** The pill while the editor's stage shows the hidden layers; `insets`, the stage's edges the chrome covers. */
export function HiddenShownPill({ editor, insets }: { editor: Editor; insets: ChromeInsets | null }) {
  const t = useMessages().editor.view
  const rtl = dirOf(useLocale()) === 'rtl'
  const shown = useHiddenShown(editor)
  const { flyoutEnd } = useEditState()
  const row = useRef<HTMLDivElement>(null)
  const sheetTop = useSheetTop()
  const [underSheet, setUnderSheet] = useState(false)
  // Measured once the pill is on the page, and again as a sheet opens, grows or closes.
  useLayoutEffect(() => {
    const sheet = shown && row.current ? sheetTopIn(row.current) : null
    setUnderSheet(sheet !== null && sheet < PILL_ROOM)
  }, [shown, sheetTop, insets])
  if (!shown) return null
  const end = (rtl ? insets?.left : insets?.right) ?? 0
  return (
    <div
      ref={row}
      className="pointer-events-none absolute z-[5] flex justify-center px-3"
      style={{
        top: insets?.top ?? 0,
        insetInlineStart: flyoutEnd ?? 0,
        insetInlineEnd: end,
        visibility: underSheet ? 'hidden' : undefined,
      }}
    >
      <div role="status" data-testid="hidden-shown" className={TOAST}>
        <EyeSlashIcon size={14} aria-hidden className="shrink-0 text-subtle" />
        <span>{t.hiddenShown}</span>
        <span aria-hidden className="text-subtle">
          ·
        </span>
        <Button
          variant="ghost"
          className={`h-7 ${TOUCH_FIELD} shrink-0 px-2.5 text-tiny font-semibold text-accent-text`}
          onClick={() => editor.setHiddenShown(false)}
        >
          {t.hideHidden}
        </Button>
      </div>
    </div>
  )
}
