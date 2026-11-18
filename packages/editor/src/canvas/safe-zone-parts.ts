// The safe zones over the stage: on each 9:16 frame in view, the bands that one platform's
// interface, or every platform's together, covers, as the platforms publish them (`@dazbee/schema`'s
// `safeZoneBands`). Only the overlay draws them, so no export does.
import { type Rect, safeZoneBands, type SafeZoneChoice } from '@dazbee/schema'

import type { Frame } from './frames.ts'

/**
 * A band of each 9:16 frame given, placed over it on the stage by `placeBox`: the named platform's,
 * or every platform's together for `ALL_PLATFORMS`.
 */
export function safeZoneParts(
  frames: readonly Frame[],
  placeBox: (el: HTMLElement, frame: Frame, box: Rect) => void,
  platform: SafeZoneChoice,
): HTMLElement[] {
  return frames.flatMap((frame) =>
    safeZoneBands(frame.width, frame.height, platform).map((band) => {
      const el = document.createElement('div')
      el.className = 'safe-zone'
      el.dataset.frame = frame.id
      placeBox(el, frame, band)
      return el
    }),
  )
}
