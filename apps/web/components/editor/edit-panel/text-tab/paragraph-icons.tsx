// The paragraph choices Iconoir has no icon for, drawn in its style (a 24 px box, 1.6 px round
// strokes): where text sits up and down in its box, and which way its lines run.
import type { ReactNode } from 'react'

/** A text box with two lines of text at its top, middle or bottom. */
export function VerticalPlaceIcon({ place }: { place: 'top' | 'middle' | 'bottom' }) {
  const y = { top: 7.5, middle: 10.5, bottom: 13.5 }[place]
  return (
    <Drawn>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
      <path d={`M7.5 ${y}h9M7.5 ${y + 3}h6`} />
    </Drawn>
  )
}

/** A paragraph mark over an arrow: to the right, to the left, or both ways for auto. */
export function TextDirectionIcon({ direction }: { direction: 'auto' | 'ltr' | 'rtl' }) {
  const mark =
    direction === 'rtl'
      ? 'M11 4v11M15 4v11M17 4h-5.5a3.5 3.5 0 0 0 0 7H13'
      : 'M9 4v11M13 4v11M15 4H9.5a3.5 3.5 0 0 0 0 7H11'
  const centred = 'M10 4v11M14 4v11M16 4h-5.5a3.5 3.5 0 0 0 0 7H12'
  const arrow = {
    auto: 'M5 19h14M8 16.5 5 19l3 2.5M16 16.5l3 2.5-3 2.5',
    ltr: 'M5 19h14M16 16.5l3 2.5-3 2.5',
    rtl: 'M19 19H5M8 16.5 5 19l3 2.5',
  }[direction]
  return (
    <Drawn>
      <path d={direction === 'auto' ? centred : mark} />
      <path d={arrow} />
    </Drawn>
  )
}

function Drawn({ children }: { children: ReactNode }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  )
}
