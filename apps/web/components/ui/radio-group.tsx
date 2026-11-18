'use client'

// A group of choices of which one is on, over Radix's radio group, as WAI-ARIA's radio group pattern
// has it: Tab reaches the choice that is on, or the first while none is, and Tab again leaves the
// group; the arrows move to the next choice or the one before and turn it on, round from the ends,
// the side arrows following the app's reading direction; Space turns on the focused choice, and so
// does Enter, as it presses any button of the app.
import * as RadixRadio from '@radix-ui/react-radio-group'
import type { ComponentProps, KeyboardEvent, ReactNode } from 'react'

import { useLocale } from '@/lib/i18n/client.tsx'
import { dirOf } from '@/lib/i18n/index.ts'

/**
 * A group of `Radio`s, one for each of `options`, of which the one whose value is `value` is on;
 * none is while it is 'mixed', as for layers that differ, or undefined. `onPick` hears the choice a
 * click, an arrow or Enter turns on. It is named by `label`, or by the visible label whose id is
 * `labelledBy`.
 */
export function RadioGroup<T extends string>({
  label,
  labelledBy,
  options,
  value,
  onPick,
  testId,
  className,
  children,
}: {
  label?: string | undefined
  labelledBy?: string | undefined
  options: readonly T[]
  value: T | 'mixed' | undefined
  onPick: (to: T) => void
  testId?: string | undefined
  className?: string
  children: ReactNode
}) {
  const dir = dirOf(useLocale())
  return (
    <RadixRadio.Root
      dir={dir}
      value={value === 'mixed' || value === undefined ? null : value}
      onValueChange={(to) => {
        const picked = options.find((option) => option === to)
        if (picked !== undefined) onPick(picked)
      }}
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      data-testid={testId}
      className={className}
    >
      {children}
    </RadixRadio.Root>
  )
}

/** One choice of a RadioGroup, by its `value`, one of the group's options: a button, `aria-checked` while it is the one on. */
export function Radio({ onKeyDown, ...props }: ComponentProps<typeof RadixRadio.Item>) {
  return (
    <RadixRadio.Item
      {...props}
      // Before Radix's own handler, which keeps Enter from pressing the button.
      onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
        onKeyDown?.(event)
        if (event.key === 'Enter' && !event.defaultPrevented) event.currentTarget.click()
      }}
    />
  )
}
