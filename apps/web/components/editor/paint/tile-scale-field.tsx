'use client'

// A tiled image's Scale, shown while its fit is Tile: in the paint stack beside Fit, and in a
// photo's Fit pop-up under its tiles.
import type { Editor } from '@dazbee/editor'
import { TILE_SCALE } from '@dazbee/schema'

import { clamp, NumberField } from '@/components/editor/edit-panel/number-field.tsx'
import { LIMITS } from '@/lib/editor/limits.ts'
import { tidy } from '@/lib/editor/size.ts'
import { useMessages } from '@/lib/i18n/client.tsx'

/** The smallest tile scale, as stored: 1 % of the image's own size, as the schema holds it. */
const SMALLEST = TILE_SCALE.min

/**
 * The Scale of a tiled image fill, in % of the image's own size, from 1 % to `LIMITS.tileScale`.
 * `value` is as stored, left out read as 1; `onScale` changes each fill's own scale.
 */
export function TileScaleField({
  value,
  editor,
  onScale,
}: {
  value: number | undefined | 'mixed'
  editor?: Editor | undefined
  onScale: (to: (now: number) => number) => void
}) {
  const p = useMessages().editor.props
  const held = (scale: number) => tidy(clamp(scale, SMALLEST, LIMITS.tileScale))
  return (
    <NumberField
      label={p.tileScaleShort}
      name={p.tileScale}
      value={value === 'mixed' ? value : (value ?? 1)}
      scale={100}
      unit="%"
      min={SMALLEST}
      max={LIMITS.tileScale}
      editor={editor}
      testId="tile-scale"
      onSet={(v) => onScale(() => held(v))}
      onEach={(change) => onScale((now) => held(change(now)))}
    />
  )
}
