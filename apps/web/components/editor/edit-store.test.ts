import { describe, expect, it, vi } from 'vitest'

import {
  asPanelGoes,
  closesWithSelection,
  editState,
  isPanel,
  isSheet,
  keptBySelecting,
  newSelection,
  onF6,
  panelFor,
  selectionPanelShows,
  setOpen,
  setSheetHeight,
  shownSwitcherTab,
  toggleFlyout,
} from './edit-store.ts'

/** The page's focus as the panel's rules read it, recording where they send it. */
const focusAt = (inPanel: boolean) => ({ inPanel, toStage: vi.fn(), toSwitcher: vi.fn() })

describe('isPanel', () => {
  it('lets the font chooser and the design’s cards take the edit panel’s place', () => {
    const cards = ['pages', 'versions', 'addFrame', 'addSize', 'findReplace']
    expect(['font', ...cards].every(isPanel)).toBe(true)
  })

  it('shows Spacing in the Text switcher tab, not in its place', () => {
    expect(isPanel('spacing')).toBe(false)
  })

  it('floats Share, the full menu, Replace’s picker and the pop-ups over it', () => {
    const floating = [null, 'share', 'more', 'replace', 'align', 'transparency', 'line-up']
    expect(floating.map(isPanel)).toEqual(floating.map(() => false))
  })

  it('shows Position and a box’s layout in the panel, not in its place', () => {
    expect(isPanel('position')).toBe(false)
    expect(isPanel('box')).toBe(false)
  })

  it('shows Style’s colour, outline and effects in the panel, not in its place', () => {
    expect(['colour', 'outline', 'effects'].map(isPanel)).toEqual([false, false, false])
  })

  it("shows a picked frame's Background and Position in the panel, and floats its ⋯ over it", () => {
    expect(['background', 'framePosition', 'frame-more'].map(isPanel)).toEqual([false, false, false])
  })

  it('shows a photo’s filters and adjustments in the Image switcher tab, not in its place', () => {
    expect(isPanel('edit')).toBe(false)
  })
})

describe('isSheet', () => {
  it('opens Pages and Versions above the phone’s tab bar, and every other edit panel and the full menu as a sheet', () => {
    expect(['pages', 'versions'].map(isSheet)).toEqual([false, false])
    expect(['findReplace', 'addSize', 'font', 'more'].map(isSheet)).toEqual([true, true, true, true])
    expect([null, 'share'].map(isSheet)).toEqual([false, false])
  })
})

describe('closesWithSelection', () => {
  it('keeps Pages, Versions, Add a frame and Find and replace open as the selection goes, and closes the rest', () => {
    expect(['pages', 'versions', 'addFrame', 'findReplace'].map(closesWithSelection)).toEqual([
      false,
      false,
      false,
      false,
    ])
    expect(['frame-more', 'addSize', 'font', 'more'].map(closesWithSelection)).toEqual([true, true, true, true])
  })
})

describe('keptBySelecting', () => {
  it('keeps only Find and replace open as layers are selected, since it selects what it finds', () => {
    expect(keptBySelecting('findReplace')).toBe(true)
    expect(['pages', 'addFrame', 'font', 'more', null].map(keptBySelecting)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ])
  })
})

describe('panelFor', () => {
  it('shows the selected layers’ panel while layers are selected', () => {
    expect(panelFor(true, null)).toBe('layers')
  })

  it('shows the picked frame’s panel with the pick, and none once the frame is let go', () => {
    expect(panelFor(false, 'f1')).toBe('frame')
    expect(panelFor(false, null)).toBeNull()
  })
})

describe('selectionPanelShows', () => {
  it('opens with a selection that has switcher tabs, and goes with none', () => {
    expect(selectionPanelShows(null, true)).toBe(true)
    expect(selectionPanelShows(null, false)).toBe(false)
  })

  it('gives its place to the font chooser or a design card while one is open, and floats a pop-up or Share over it', () => {
    expect(['font', 'pages', 'findReplace'].map((open) => selectionPanelShows(open, true))).toEqual([
      false,
      false,
      false,
    ])
    expect(['share', 'more', 'align', 'replace'].map((open) => selectionPanelShows(open, true))).toEqual([
      true,
      true,
      true,
      true,
    ])
  })

  it("opens a picked frame's panel with the pick, gives its place to Add size, and floats its ⋯ over it", () => {
    expect(selectionPanelShows(null, true)).toBe(true)
    expect(selectionPanelShows('addSize', true)).toBe(false)
    expect(selectionPanelShows('frame-more', true)).toBe(true)
  })
})

describe('shownSwitcherTab', () => {
  it('opens on the switcher tab last picked while the selection has it', () => {
    expect(shownSwitcherTab(['style', 'arrange'], 'arrange')).toBe('arrange')
  })

  it('opens on the first switcher tab when none was picked or the selection lacks the last one', () => {
    expect(shownSwitcherTab(['text', 'style', 'arrange'], null)).toBe('text')
    expect(shownSwitcherTab(['style', 'arrange'], 'text')).toBe('style')
  })

  it('shows none for a selection with no switcher tabs', () => {
    expect(shownSwitcherTab([], 'arrange')).toBeNull()
  })
})

describe('onF6', () => {
  it('moves the focus from the stage or elsewhere into the switcher', () => {
    const focus = focusAt(false)
    onF6(focus)
    expect(focus.toSwitcher).toHaveBeenCalledOnce()
    expect(focus.toStage).not.toHaveBeenCalled()
  })

  it('moves the focus from inside the panel back to the stage', () => {
    const focus = focusAt(true)
    onF6(focus)
    expect(focus.toStage).toHaveBeenCalledOnce()
    expect(focus.toSwitcher).not.toHaveBeenCalled()
  })
})

describe('asPanelGoes', () => {
  it('gives the stage back a focus that was inside the panel', () => {
    const focus = focusAt(true)
    asPanelGoes(focus)
    expect(focus.toStage).toHaveBeenCalledOnce()
  })

  it('leaves a focus elsewhere where it is', () => {
    const focus = focusAt(false)
    asPanelGoes(focus)
    expect(focus.toStage).not.toHaveBeenCalled()
  })
})

describe('newSelection', () => {
  it('starts the sheet low and the panel scrolled to its top', () => {
    setSheetHeight('full')
    const before = editState().selections
    newSelection(true)
    expect(editState().sheetHeight).toBe('low')
    expect(editState().selections).toBe(before + 1)
  })

  it('closes what was opened for the selection, and keeps Find and replace as layers are selected', () => {
    setOpen('font')
    newSelection(true)
    expect(editState().open).toBeNull()
    setOpen('findReplace')
    newSelection(true)
    expect(editState().open).toBe('findReplace')
    setOpen('pages')
    newSelection(false)
    expect(editState().open).toBe('pages')
    setOpen(null)
  })
})

describe('toggleFlyout', () => {
  it('opens a flyout, closes it as its own key or button does again, and opens another in its place', () => {
    toggleFlyout('assets', false)
    expect(editState().flyout).toBe('assets')
    toggleFlyout('layers', false)
    expect(editState().flyout).toBe('layers')
    toggleFlyout('layers', false)
    expect(editState().flyout).toBeNull()
  })

  it('on a phone, closes the edit panel as it opens, and leaves it be as it closes', () => {
    setOpen('font')
    toggleFlyout('assets', false)
    expect(editState().open).toBe('font')
    toggleFlyout('assets', true)
    expect([editState().flyout, editState().open]).toEqual([null, 'font'])
    toggleFlyout('assets', true)
    expect([editState().flyout, editState().open]).toEqual(['assets', null])
    toggleFlyout('assets', true)
  })
})
