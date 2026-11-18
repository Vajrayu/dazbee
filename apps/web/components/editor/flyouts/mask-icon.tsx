// A mask's icon in the layers panel: a dashed ring round a dot, in the current colour.

/** The icon's size in pixels. */
export const MASK_ICON = 13

export function MaskIcon() {
  return (
    <svg width={MASK_ICON} height={MASK_ICON} viewBox="0 0 13 13" fill="none" aria-hidden data-testid="mask-icon">
      <circle cx="6.5" cy="6.5" r="5.6" stroke="currentColor" strokeWidth="1.25" strokeDasharray="2.2 1.5" />
      <circle cx="6.5" cy="6.5" r="2.4" fill="currentColor" />
    </svg>
  )
}
