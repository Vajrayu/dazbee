// A frame's size as the chrome shows it, width × height, isolated left to right, so it reads the
// same in a right-to-left language: 720 × 900 never shows as 900 × 720. The size tiles, the layers
// panel's frame stepper and the export menu's frame rows show it; the stage is left to right already.
import type { ComponentProps } from 'react'

import { shortSizeOf, sizeOf } from '@/lib/editor/size.ts'

/** A size as text, in `sizeOf`'s words or, `short`, a chip's; any other prop goes to its span. */
export function SizeText({
  size,
  short = false,
  ...props
}: { size: { width: number; height: number }; short?: boolean } & Omit<ComponentProps<'span'>, 'dir' | 'children'>) {
  return (
    <span {...props} dir="ltr">
      {short ? shortSizeOf(size) : sizeOf(size)}
    </span>
  )
}
