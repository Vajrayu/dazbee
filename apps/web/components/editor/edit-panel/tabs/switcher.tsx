'use client'

// The switcher: the row of switcher tabs at the top of the edit panel, as a tab list in a well, the
// shown one on the glass chip. A click picks a switcher tab; the arrow keys, Home and End move along
// the row in the reading direction, picking the one they reach. Only the shown one is in the Tab order,
// and a focus on another switcher tab moves to it once it shows, as Shift+I shows a picked frame's
// Background.
import { type KeyboardEvent, useEffect, useRef } from 'react'

import { moveAlong } from '@/components/editor/arrow-keys.ts'
import { SEGMENT, SEGMENTS } from '@/components/ui/looks.ts'
import { cn } from '@/lib/cn.ts'
import { useMessages } from '@/lib/i18n/client.tsx'

import type { SwitcherTabId } from './tabs.ts'

/** The id of the switcher tab `id`'s button, which names its tab panel. */
export const switcherTabId = (id: SwitcherTabId) => `switcher-tab-${id}`
/** The id of the tab panel the switcher shows into. */
export const SWITCHER_PANEL_ID = 'switcher-panel'

/** The keys that move along the switcher, picking the switcher tab they reach: the arrow keys across, Home and End. */
const MOVES: readonly string[] = ['ArrowLeft', 'ArrowRight', 'Home', 'End']

/** Whether `key` moves along the switcher; any other key on a focused switcher tab picks none. */
export function movesAlong(key: string) {
  return MOVES.includes(key)
}

export function Switcher({
  switcherTabs,
  shown,
  onPick,
}: {
  switcherTabs: SwitcherTabId[]
  shown: SwitcherTabId
  onPick: (id: SwitcherTabId) => void
}) {
  const t = useMessages()
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const at = document.activeElement
    if (!(at instanceof HTMLElement) || !list.current?.contains(at) || at.dataset.switcherTab === shown) return
    list.current.querySelector<HTMLElement>(`[data-switcher-tab="${shown}"]`)?.focus()
  }, [shown])
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!movesAlong(event.key)) return
    moveAlong(event, [...event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')])
    const reached = (document.activeElement as HTMLElement | null)?.dataset.switcherTab as SwitcherTabId | undefined
    if (reached && reached !== shown) onPick(reached)
  }
  return (
    <div
      ref={list}
      role="tablist"
      aria-label={t.editor.editPanel.switcher}
      data-switcher
      onKeyDown={onKeyDown}
      className={cn(SEGMENTS, 'mx-3 mb-2 shrink-0 auto-cols-fr')}
    >
      {switcherTabs.map((id) => (
        <button
          key={id}
          type="button"
          role="tab"
          id={switcherTabId(id)}
          aria-selected={id === shown}
          aria-controls={SWITCHER_PANEL_ID}
          tabIndex={id === shown ? 0 : -1}
          data-switcher-tab={id}
          onClick={() => onPick(id)}
          className={cn(SEGMENT, 'aria-selected:bg-chip aria-selected:text-text')}
        >
          {t.editor.editPanel.switcherTabs[id]}
        </button>
      ))}
    </div>
  )
}
