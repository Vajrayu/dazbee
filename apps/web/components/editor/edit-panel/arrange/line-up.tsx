'use client'

// Several layers' Line up in Arrange: lining them up with each other, as a row of icons, then
// spreading them.
import { SPREAD_MIN } from '@dazbee/editor'

import { ALIGN, DISTRIBUTE } from '@/components/editor/arrange-actions.ts'
import { type Target } from '@/components/editor/edit-panel/target.ts'
import { useMessages } from '@/lib/i18n/client.tsx'

import { PanelAction } from './panel-action.tsx'

/**
 * Several layers' Line up: the six ways to line them up with each other as icons (left, centre,
 * right, top, middle, bottom), each named by where it lines up to, then spreading them, which needs
 * a layer between the two at the ends. Greyed while `why` says the layers are locked, each saying so.
 */
export function LineUpEachOther({ target, why }: { target: Target; why: string | null }) {
  const t = useMessages()
  const named = t.editor.shortActions
  const tooFew = target.ids.length < SPREAD_MIN ? t.editor.bar.needsThree : null
  return (
    <>
      <div
        dir="ltr"
        role="group"
        aria-label={t.editor.arrange.align}
        className="grid grid-cols-6 gap-1.5 max-sm:gap-[8px]"
      >
        {ALIGN.map(({ action, icon }) => (
          <PanelAction key={action} target={target} action={action} name={named[action]} icon={icon} why={why} knob />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-1.5 max-sm:gap-[8px]">
        {DISTRIBUTE.map(({ action, icon }) => (
          <PanelAction
            key={action}
            target={target}
            action={action}
            name={named[action]}
            icon={icon}
            why={why ?? tooFew}
          />
        ))}
      </div>
    </>
  )
}
