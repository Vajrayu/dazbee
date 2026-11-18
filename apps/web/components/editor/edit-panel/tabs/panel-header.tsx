'use client'

// The edit panel's header: what is selected, by the layer's name, how many layers or the picked
// frame's name; while a layer is locked its lock, whose click unlocks it, and to a tab that may only
// view, the lock only showing it locked; and what the panel adds at its end, as a picked frame's ⋯.
import type { ReactNode } from 'react'

import type { Editor } from '@dazbee/editor'

import { ICON_BUTTON } from '@/components/editor/styles.ts'
import { LockSimpleIcon } from '@/components/ui/icons.tsx'
import { Tooltip } from '@/components/ui/tooltip.tsx'
import { useMessages } from '@/lib/i18n/client.tsx'

import type { Control } from './tabs.ts'

/** The header's id, which names the edit panel. */
export const PANEL_HEADER_ID = 'edit-panel-title'

export function PanelHeader({
  editor,
  name,
  controls,
  locked = [],
  children,
}: {
  editor: Editor
  /** What is selected: the layer's name, how many layers, or the picked frame's name. */
  name: string
  controls: Control[]
  /** The selected layers that are locked, which the lock unlocks. */
  locked?: string[]
  /** What else the header holds at its end, as a picked frame's ⋯. */
  children?: ReactNode
}) {
  const t = useMessages()
  return (
    <div className="flex min-h-12 shrink-0 items-center gap-2 py-1.5 ps-4 pe-2">
      <h2
        id={PANEL_HEADER_ID}
        title={name}
        className="min-w-0 flex-1 truncate font-display text-card leading-[1.3] font-bold tracking-tight"
      >
        {name}
      </h2>
      {controls.includes('unlock') && (
        <Tooltip label={t.editor.editPanel.unlock}>
          <button
            type="button"
            aria-label={t.editor.editPanel.unlock}
            data-testid="panel-unlock"
            onClick={() => editor.setLocked(locked, false)}
            className={`${ICON_BUTTON} text-text`}
          >
            <LockSimpleIcon size={15} weight="fill" aria-hidden />
          </button>
        </Tooltip>
      )}
      {controls.includes('locked') && (
        <span
          role="img"
          aria-label={t.editor.editPanel.locked}
          data-testid="panel-locked"
          className="grid size-7 place-items-center text-muted"
        >
          <LockSimpleIcon size={15} weight="fill" aria-hidden />
        </span>
      )}
      {children}
    </div>
  )
}
