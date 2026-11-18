'use client'

// What the editor has open over the stage: one pop-up, the full menu or one card in the edit
// panel's place, never two at once, since they share this one value. Opening any of them closes
// what was open. The edit panel follows the selection and the picked frame: it shows their switcher
// tabs, on the one last picked, unless the font chooser or a design card takes its place; pop-ups
// and menus float over it. The shell reads it too: on a phone an edit panel, the full menu and the
// right-click menu are sheets, and a flyout and a sheet close each other. Also the open flyout,
// which its button, I for Assets, and Quick actions open and close. Below
// EDIT_SHEET_WIDTH the edit panel is a sheet at the bottom, low or full: each new selection starts
// it low and scrolled to its top. Also where the top islands end, which the edit panel and the menus
// stay under; whether something stands over the edit panel, which Esc closes first; the menu's
// button a rename field gives the focus back to; and the Share menu's listener for an Export asked
// from a picked frame's ⋯.
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react'

import type { SwitcherTabId } from '@/components/editor/edit-panel/tabs/tabs.ts'
import { OVER_PANEL } from '@/components/ui/menu-close.ts'

/** The flyouts, each opened by its button at the dock's end, or on a phone the tab bar's start. */
export type Flyout = 'layers' | 'assets' | 'ai' | 'brand'

/** The font chooser, which the Text switcher tab's font opens in the edit panel's place, for the selected texts. */
export const FONT_CHOOSER = 'font'
/**
 * The design's own panels, each with whether it belongs to the picked frame it was opened for, so
 * picking another frame or letting it go closes it: Pages, from by the zoom, stays; Add a frame,
 * open while the Frame tool is, stays; Add size, the same card adding a size to the picked frame,
 * from its ⋯, goes; and Find and replace and Versions, from the
 * save status, stay. Selecting layers closes each of them but Find and replace (`keptBySelecting`),
 * which selects what it finds.
 */
const DESIGN_PANELS = {
  pages: { ofPickedFrame: false, keptBySelecting: false },
  versions: { ofPickedFrame: false, keptBySelecting: false },
  addFrame: { ofPickedFrame: false, keptBySelecting: false },
  addSize: { ofPickedFrame: true, keptBySelecting: false },
  findReplace: { ofPickedFrame: false, keptBySelecting: true },
} as const satisfies Record<string, { ofPickedFrame: boolean; keptBySelecting: boolean }>
type DesignPanelId = keyof typeof DESIGN_PANELS
/** The pop-ups that open as a sheet at the bottom on a phone, as an edit panel does: the full menu. */
const SHEET_POPUPS = ['more'] as const
/** The design's cards that open above the phone's tab bar, the bar still showing, rather than as a sheet. */
const OVER_TAB_BAR: readonly string[] = ['pages', 'versions']
export type PanelId = typeof FONT_CHOOSER | DesignPanelId
/** The edit panel's sheet's two heights: low, its first rows, and full, all of it. */
export type SheetHeight = 'low' | 'full'
/** The page as the edit panel's focus rules read it: whether the focus is inside the panel, and where it can go. */
export interface PanelFocus {
  inPanel: boolean
  /** Gives the stage the keys, taking the focus off what has it. */
  toStage: () => void
  /** Moves the focus into the panel: to the switcher's shown switcher tab, or with no switcher to its first control. */
  toSwitcher: () => void
}
/** Every id that opens a panel in the edit panel's place; every other id is a pop-up or a menu, floating over it. */
const PANELS: readonly PanelId[] = [FONT_CHOOSER, ...(Object.keys(DESIGN_PANELS) as DesignPanelId[])]

interface EditState {
  /** The open pop-up, full menu or card in the edit panel's place, by its id. */
  open: string | null
  /** The top islands' bottom edge, in the stage's pixels: the edit panel and the menus stay under it. */
  islandsBottom: number
  /** How far the open flyout reaches from the stage's start edge on tablet and desktop, in pixels; null with none open. */
  flyoutEnd: number | null
  /** Whether the right-click menu is open, which is a sheet on a phone as the full menu is. */
  rightClick: boolean
  /** The switcher tab last picked, for this session only. */
  pickedSwitcherTab: SwitcherTabId | null
  /** The edit panel's sheet's height, low for each new selection. */
  sheetHeight: SheetHeight
  /** Whether the edit panel shows as a sheet at its full height, which hides the phone's tab bar as a sheet does. */
  fullSheet: boolean
  /** The open flyout, or null; on a phone the edit panel's sheet waits for it to close. */
  flyout: Flyout | null
  /** How many times the selection or the picked frame has changed, so the panel starts each new one at its top. */
  selections: number
}

let state: EditState = {
  open: null,
  islandsBottom: 0,
  flyoutEnd: null,
  rightClick: false,
  pickedSwitcherTab: null,
  sheetHeight: 'low',
  fullSheet: false,
  flyout: null,
  selections: 0,
}
const listeners = new Set<() => void>()
/** The menu's button a rename was asked from, which the rename field gives the focus back to as it ends from the keyboard. */
let renameOpener: HTMLElement | null = null
/** What the Share menu does with an Export asked from elsewhere: open it with these frames ticked. */
let exportListener: ((frameIds: string[], opener: HTMLElement | null) => void) | null = null

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Whether what is open takes the edit panel's place: the font chooser, or a design card. */
export const isPanel = (id: string | null): id is PanelId => (PANELS as readonly string[]).includes(id ?? '')
/** Whether what is open is a sheet at the bottom on a phone: every edit panel but Pages and Versions, and the full menu. */
export const isSheet = (id: string | null) =>
  (isPanel(id) && !OVER_TAB_BAR.includes(id)) || (SHEET_POPUPS as readonly string[]).includes(id ?? '')
/**
 * Whether a menu is open as a sheet on a phone: the full menu or the right-click menu, which the
 * header's islands give way to. An edit panel's sheet stops lower and keeps the
 * header, so undo, redo and Share stay in reach.
 */
export const isMenuSheet = ({ open, rightClick }: Pick<EditState, 'open' | 'rightClick'>) =>
  (SHEET_POPUPS as readonly string[]).includes(open ?? '') || rightClick
/**
 * Whether what is open closes when the selection or the picked frame changes: a pop-up, the full
 * menu, the font chooser, or a panel of the picked frame.
 */
export const closesWithSelection = (id: string | null) =>
  !isPanel(id) || id === FONT_CHOOSER || DESIGN_PANELS[id].ofPickedFrame
/** Whether what is open stays open as layers are selected: Find and replace, which selects what it finds. */
export const keptBySelecting = (id: string | null) =>
  isPanel(id) && id !== FONT_CHOOSER && DESIGN_PANELS[id].keptBySelecting
/**
 * What the edit panel is for: the selected layers while there are any, else the picked frame, from
 * the pick until it is let go; else nothing, and no panel.
 */
export const panelFor = (layers: boolean, picked: string | null) => (layers ? 'layers' : picked ? 'frame' : null)
/**
 * Whether the edit panel shows the selection: it has switcher tabs, and nothing open takes the
 * panel's place (`isPanel`). Pop-ups, Share and the menus float over it and leave it.
 */
export const selectionPanelShows = (open: string | null, hasSwitcherTabs: boolean) => hasSwitcherTabs && !isPanel(open)
/**
 * The switcher tab shown of `switcherTabs`: the one last picked while the selection has it, else
 * the first; none for a selection with no switcher tabs.
 */
export const shownSwitcherTab = <T extends string>(switcherTabs: readonly T[], picked: string | null): T | null =>
  switcherTabs.find((id) => id === picked) ?? switcherTabs[0] ?? null
/** F6: from inside the edit panel the focus goes back to the stage, from anywhere else into the panel. */
export const onF6 = (focus: PanelFocus) => (focus.inPanel ? focus.toStage() : focus.toSwitcher())
/** As the edit panel goes: a focus inside it goes back to the stage, and one elsewhere stays. */
export const asPanelGoes = (focus: Pick<PanelFocus, 'inPanel' | 'toStage'>) => {
  if (focus.inPanel) focus.toStage()
}

/**
 * As the selection or the picked frame changes: closes what was opened for the old one, as the
 * rules above say, and starts the edit panel afresh, its sheet low and scrolled to its top. `layers`
 * says whether layers are selected now.
 */
export function newSelection(layers: boolean) {
  const now = state.open
  update({
    open: (layers && !keptBySelecting(now)) || closesWithSelection(now) ? null : now,
    sheetHeight: 'low',
    selections: state.selections + 1,
  })
}

/** Opens a pop-up, the full menu or an edit panel by its id, closing what was open; null closes it. */
export const setOpen = (open: string | null) => update({ open })
/** Notes where the top islands end, as the shell measures them. */
export const setIslandsBottom = (islandsBottom: number) => update({ islandsBottom })
export const setFlyoutEnd = (flyoutEnd: number | null) => update({ flyoutEnd })
export const setRightClick = (rightClick: boolean) => update({ rightClick })
/** Sets the edit panel's sheet's height, as its handle is dragged or pressed. */
export const setSheetHeight = (sheetHeight: SheetHeight) => update({ sheetHeight })
/** Notes whether the edit panel shows as a sheet at its full height. */
export const setFullSheet = (fullSheet: boolean) => update({ fullSheet })
/** Opens a flyout, or closes it with null. */
export const setFlyout = (flyout: Flyout | null) => update({ flyout })
/** Opens a flyout, or closes it when it is the one open; on a phone opening it closes the edit panel, which waits for it. */
export function toggleFlyout(id: Flyout, phone: boolean) {
  const open = state.flyout === id
  update({ flyout: open ? null : id, ...(phone && !open && { open: null }) })
}
/** Picks a switcher tab, which later selections open on while they have it. */
export const pickSwitcherTab = (pickedSwitcherTab: SwitcherTabId) => update({ pickedSwitcherTab })
export const editState = () => state
/** Notes the menu's button a rename is asked from, just before asking, for the field to give the focus back to. */
export const setRenameOpener = (opener: HTMLElement | null) => {
  renameOpener = opener
}
/** The menu's button the rename asked for now came from, or null for one asked from the canvas; read once. */
export function takeRenameOpener() {
  const opener = renameOpener
  renameOpener = null
  return opener
}
/**
 * Opens Export in the Share menu with only these frames ticked, as a picked frame's ⋯ does; Esc
 * gives the focus back to `opener`, the menu's button it was asked from.
 */
export const askExport = (frameIds: string[], opener: HTMLElement | null) => exportListener?.(frameIds, opener)
/** Hears each Export asked from elsewhere, until the function it returns is called; the Share menu listens. */
export function onExportAsked(listener: (frameIds: string[], opener: HTMLElement | null) => void) {
  exportListener = listener
  return () => {
    if (exportListener === listener) exportListener = null
  }
}
/**
 * Whether something stands over the edit panel, so Esc closes it first: a modal dialog, such as
 * Keyboard shortcuts, an open menu, or a pop-up that closes as `useMenuClose` says, as Share's
 * forms and the account menu do.
 */
export const overPanel = () => document.querySelector(`dialog:modal, [data-radix-menu-content], ${OVER_PANEL}`) !== null

/** What the editor has open over the stage and where the chrome sits, re-rendering the caller when that changes. */
export function useEditState() {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  )
}

/**
 * Closes what is open as the selection or the picked frame changes, as the rules above say, so a
 * font chooser or a card that took the edit panel's place gives it back to the new selection, and
 * starts the panel afresh (`newSelection`).
 */
export function useSelectionFollower(ids: string[], picked: string | null) {
  // A pop-up or panel belongs to the selection or the picked frame it was opened for: another one
  // closes it, and selecting layers closes any but Find and replace (`keptBySelecting`). Pages,
  // Versions, Add a frame and Find and replace stay open as the selection goes or another frame is picked
  // (`closesWithSelection`).
  const opened = useRef({ ids, picked })
  useLayoutEffect(() => {
    const was = opened.current
    if (was.ids === ids && was.picked === picked) return
    opened.current = { ids, picked }
    newSelection(ids.length > 0)
  }, [ids, picked])
  // As the selection's panel goes, so does what was opened for the selection; the design's own cards
  // that stay as the selection goes stay too, as the panel starts afresh on a version viewed and on
  // the live design after it.
  useEffect(
    () => () => {
      if (closesWithSelection(editState().open)) setOpen(null)
    },
    [],
  )
}

function update(change: Partial<EditState>) {
  const next = { ...state, ...change }
  if (Object.keys(change).every((key) => Object.is(next[key as keyof EditState], state[key as keyof EditState]))) return
  state = next
  for (const listener of listeners) listener()
}
