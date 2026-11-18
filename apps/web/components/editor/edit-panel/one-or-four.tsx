'use client'

// One value for all four sides or corners, or each its own: a label with a button at its end that
// opens four fields in place of one, as Around and Corners do. The four open by themselves while the
// values differ. Opening and closing them changes nothing in the design.
import { type ReactNode, useState } from 'react'

import { FIELD_LABEL, ICON_BUTTON, KNOBS } from '@/components/editor/styles.ts'
import { FOCUS_RING } from '@/components/ui/looks.ts'
import { cn } from '@/lib/cn.ts'

/** The button's look: pressed, it is lit in the accent, as a toggle is. */
const EACH_BUTTON = cn(
  ICON_BUTTON,
  'size-6 aria-pressed:bg-accent-soft aria-pressed:text-accent-text [@media(hover:none)]:size-[44px]',
  FOCUS_RING,
)

/**
 * A label, the button at its end named `eachName`, and under them `one` field or the `four`, two
 * by two. The four show once `differ` says the values do, until the button closes them.
 */
export function OneOrFour({
  id,
  label,
  eachName,
  icon,
  differ,
  one,
  four,
}: {
  id: string
  label: string
  eachName: string
  icon: ReactNode
  differ: boolean
  one: ReactNode
  four: ReactNode
}) {
  // What the button chose last; until it is pressed, the four show once the values differ, and stay
  // while they are edited alike again, so the field being typed in keeps the focus.
  const [chosen, setChosen] = useState<boolean | null>(null)
  if (chosen === null && differ) setChosen(true)
  const each = chosen ?? differ
  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-testid={id}>
      <div className="flex min-h-6 items-center justify-between gap-2">
        <span className={FIELD_LABEL}>{label}</span>
        <button
          type="button"
          aria-label={eachName}
          title={eachName}
          aria-pressed={each}
          onClick={() => setChosen(!each)}
          className={EACH_BUTTON}
        >
          {icon}
        </button>
      </div>
      {each ? (
        <div dir="ltr" className={KNOBS}>
          {four}
        </div>
      ) : (
        one
      )}
    </div>
  )
}
