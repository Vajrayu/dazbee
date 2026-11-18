'use client'

// Arrange's Wrap in section for several layers: wrapping them in a group or a box.
import { HOLDER_ICONS } from '@/components/editor/box-layouts.ts'
import { PanelTitle } from '@/components/editor/edit-panel/fields.tsx'
import { factsOf, type PanelProps } from '@/components/editor/edit-panel/target.ts'
import { useSelectionState } from '@/components/editor/editor-hooks.ts'
import { wrapWhy } from '@/components/editor/menus/layer-actions.tsx'
import { PANEL_PART } from '@/components/editor/styles.ts'
import { useMessages } from '@/lib/i18n/client.tsx'

import { PanelAction } from './panel-action.tsx'

/** The ways to wrap several layers, side by side: Group and the Box action. */
const WRAPS = [
  { action: 'group', Icon: HOLDER_ICONS.group },
  { action: 'boxSelection', Icon: HOLDER_ICONS.box },
] as const

/**
 * Group and the Box action, greyed as the full menu greys them, or while the layers are locked: a
 * greyed one's tooltip says why.
 */
export function WrapInSection({ target, design }: PanelProps) {
  const t = useMessages()
  const wrapState = useSelectionState(target.editor, target.ids, 'wrapState')
  const locked = factsOf(target, design).locked.length > 0
  const why = locked ? t.editor.bar.lockedRow : wrapWhy(wrapState, t.editor)
  return (
    <section aria-labelledby="wrap-in-part-title" className={PANEL_PART} data-testid="wrap-in-part">
      <PanelTitle id="wrap-in-part-title">{t.editor.arrange.wrapIn}</PanelTitle>
      <div className="grid grid-cols-2 gap-1.5 max-sm:gap-[8px]">
        {WRAPS.map(({ action, Icon }) => (
          <PanelAction
            key={action}
            target={target}
            action={action}
            name={t.editor.actions[action]}
            icon={Icon}
            why={why}
          />
        ))}
      </div>
    </section>
  )
}
