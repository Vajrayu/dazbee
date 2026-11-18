// The text being edited, as overlay elements: its selected range, a box for each run, or else its caret.
import type { Rect } from '@dazbee/schema'

import type { Frame } from '../canvas/frames.ts'
import type { ShownText } from './typing.ts'

/** The selected range as a box each, or else the caret, on the overlay. */
export function textParts(text: ShownText | null, placeBox: (el: HTMLElement, frame: Frame, box: Rect) => void) {
  const parts: HTMLElement[] = []
  if (!text) return parts
  for (const box of text.range) {
    const el = document.createElement('div')
    el.className = 'text-selection'
    placeBox(el, text.frame, box)
    parts.push(el)
  }
  if (text.caret) {
    const caret = document.createElement('div')
    caret.className = 'caret'
    placeBox(caret, text.frame, { ...text.caret, width: 0 })
    caret.style.width = ''
    parts.push(caret)
  }
  return parts
}
