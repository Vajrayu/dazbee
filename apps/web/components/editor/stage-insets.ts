// How much of the stage the floating chrome covers, which the editor fits the ads clear of.

/** The stage's edges the floating chrome covers, in CSS pixels, left and right as on screen. */
export interface ChromeInsets {
  top: number
  right: number
  bottom: number
  left: number
}

/** A box on the screen, as `getBoundingClientRect` gives it, in CSS pixels. */
export type Box = Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom' | 'width' | 'height'>

/** The floating chrome over the stage, each piece's box or null while it isn't there. */
export interface StageChrome {
  /** The islands at the top. */
  islands: (Box | null)[]
  /** The phone's tab bar at the bottom; null on a tablet or desktop, which have none. */
  tabBar: Box | null
  /**
   * The tool dock, holding the flyouts' buttons at its end, and the zoom pill and Pages at the
   * bottom corner. On a phone the dock is the tool tray.
   */
  dock: (Box | null)[]
}

/** The edit panel's width, in CSS pixels. It can't be resized. */
export const EDIT_PANEL_WIDTH = 300
/** How far the edit panel sits in from the stage's end edge, in CSS pixels. */
export const EDIT_PANEL_INSET = 12
/** Below this stage width, in CSS pixels, the edit panel is a sheet at the bottom, on a tablet as on a phone. */
export const EDIT_SHEET_WIDTH = 1024

/** Below this stage width, in CSS pixels, the editor is laid out for a phone. */
const PHONE_WIDTH = 640
/** Room kept between the chrome and the ads, in CSS pixels. */
const GAP = 12

/**
 * Measures how much of the stage the chrome covers. The islands cover the top, and the pieces at
 * the bottom (the dock, the zoom pill and Pages, or the phone's tab bar) cover the bottom; nothing
 * floats on either side. The phones' open sheet spans the stage, so fitting around it would leave
 * nothing: it counts for nothing, as do hidden pieces. From EDIT_SHEET_WIDTH up the edit panel's
 * place on the end side is kept clear too, whether or not it shows, so selecting never covers a
 * fitted design: the right side, or the left in right-to-left. Narrower, the panel is a sheet, which
 * adds nothing. On a phone the dock is the tool tray, which opens over the stage for a moment as a
 * menu does, so only the tab bar counts.
 */
export function measureInsets(stage: Box, chrome: StageChrome, rtl: boolean): ChromeInsets {
  const phone = stage.width < PHONE_WIDTH
  const insets = { top: 0, right: 0, bottom: 0, left: 0 }
  if (stage.width >= EDIT_SHEET_WIDTH) insets[rtl ? 'left' : 'right'] = EDIT_PANEL_INSET + EDIT_PANEL_WIDTH + GAP
  for (const box of chrome.islands) {
    if (box && box.width > 0 && box.height > 0) insets.top = Math.max(insets.top, box.bottom - stage.top + GAP)
  }
  for (const box of phone ? [chrome.tabBar] : chrome.dock) {
    if (box && box.width > 0 && box.height > 0) insets.bottom = Math.max(insets.bottom, stage.bottom - box.top + GAP)
  }
  return insets
}
