'use client'

// Recent colours as a row of swatches: the brand's colours last picked or typed on this device,
// newest first, the first RECENT_SHOWN the brand kit doesn't hold, each the same swatch as its
// neighbours. A swatch picked paints and goes first again.
import { useId } from 'react'

import { useBrandKit } from '@/components/brand-kit/use-brand-kit.ts'
import { FIELD_LABEL, SWATCH_ROW } from '@/components/editor/styles.ts'
import { cn } from '@/lib/cn.ts'
import { browserRecent, shownRecent, useRecentColours } from '@/lib/editor/recent-colours.ts'

import { Swatch } from './swatch.tsx'

/** Puts a colour first in the brand's recent colours on this device: a pick, a hex committed, the system picker's colour. */
export const rememberColour = (brandId: string, colour: string) => browserRecent.add(brandId, colour)

/** The recent colours a row shows for a brand, re-rendering the caller as they or its kit change. */
export function useShownRecent(workspaceId: string, brandId: string): string[] {
  const kit = useBrandKit(workspaceId, brandId)?.colors ?? []
  return shownRecent(
    useRecentColours(brandId),
    kit.map((c) => c.value),
  )
}

/**
 * The row of `colours`, as `useShownRecent` gives them: `size` and `gap` as its neighbours draw
 * theirs, each ringed while it is `current` when that is given. Nothing while it is empty. With
 * `heading`, its `label` shows above it, as a panel part's title does, where no part names it.
 */
export function RecentSwatches({
  brandId,
  colours,
  label,
  size,
  gap,
  current,
  heading = false,
  onPick,
}: {
  brandId: string
  colours: readonly string[]
  label: string
  size: string
  gap: string
  current?: string | null
  heading?: boolean
  onPick: (hex: string) => void
}) {
  const id = useId()
  if (colours.length === 0) return null
  const row = (
    <div
      role="group"
      {...(heading ? { 'aria-labelledby': id } : { 'aria-label': label })}
      className={cn(SWATCH_ROW, gap)}
    >
      {colours.map((hex) => (
        <Swatch
          key={hex}
          color={hex}
          label={hex}
          size={size}
          {...(current === undefined ? {} : { on: current === hex })}
          onPick={() => {
            rememberColour(brandId, hex)
            onPick(hex)
          }}
        />
      ))}
    </div>
  )
  if (!heading) return row
  return (
    <div className="flex flex-col gap-1.5">
      <span id={id} className={FIELD_LABEL}>
        {label}
      </span>
      {row}
    </div>
  )
}
