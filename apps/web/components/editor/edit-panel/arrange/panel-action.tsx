'use client'

// A button of Arrange's that runs an editor action, as a row with its name or as a knob among the
// fields, greyed with the reason while it has nothing to do.
import { type StageAction } from '@dazbee/editor'

import { type Target } from '@/components/editor/edit-panel/target.ts'
import { PANEL_ACTION } from '@/components/editor/styles.ts'
import { GreyedButton } from '@/components/ui/greyed.tsx'
import { type Icon } from '@/components/ui/icons.tsx'
import { Tooltip } from '@/components/ui/tooltip.tsx'
import { cn } from '@/lib/cn.ts'
import { keyOf } from '@/lib/editor/shortcut-keys.ts'
import { useMessages } from '@/lib/i18n/client.tsx'
import { format } from '@/lib/i18n/index.ts'

/**
 * One of Arrange's buttons that runs an editor action: its icon and `name`, its shortcut in a
 * tooltip; greyed while `why` says it has nothing to do, saying so instead. 44 px tall on a phone.
 * With `knob`, it is drawn as a knob among the fields, its icon alone and its name for a screen reader.
 */
export function PanelAction({
  target,
  action,
  name,
  icon: Shown,
  why,
  knob = false,
}: {
  target: Target
  action: StageAction
  name: string
  icon: Icon
  why: string | null
  knob?: boolean
}) {
  const t = useMessages()
  const look = cn(PANEL_ACTION, 'max-sm:h-[44px]', knob && 'h-8 justify-center border border-field-line bg-field')
  const face = (
    <>
      <Shown size={15} aria-hidden className="shrink-0" />
      <span className={knob ? 'sr-only' : undefined}>{name}</span>
    </>
  )
  if (why)
    return (
      <GreyedButton why={why} data-action={action} className={look}>
        {face}
      </GreyedButton>
    )
  return (
    <Tooltip label={format(t.editor.arrange.withKey, { label: name, key: keyOf(action) })}>
      <button type="button" data-action={action} onClick={() => target.editor.perform(action)} className={look}>
        {face}
      </button>
    </Tooltip>
  )
}
