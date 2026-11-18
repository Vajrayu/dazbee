'use client'

// Find and replace, a card in the edit panel as Pages is, opened with Ctrl+F (⌘F) or from Quick
// actions: the shown page's texts holding what is typed in Find, matched whatever its case, counted
// as it is typed; Select matches selects them, and Replace all replaces every match as one undo
// step, as FigCraft's find and replace does. It stays open as what it selects changes. A tab that
// may only view finds and selects, and replaces nothing.
import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'

import { type Editor, shortcutFor } from '@dazbee/editor'
import { composingKey, inField, isStageField } from '@dazbee/editor/dom-input'

import { PanelFrame } from '@/components/editor/edit-panel/edit-panel.tsx'
import { NoMatch } from '@/components/ui/empty-state.tsx'
import { cn } from '@/lib/cn.ts'
import { useLocale, useMessages } from '@/lib/i18n/client.tsx'
import { counted, format } from '@/lib/i18n/index.ts'

import { editState, setOpen, useEditState } from './edit-store.ts'
import { useShownPage } from './editor-hooks.ts'
import { FIELD, FIELD_LABEL, PANEL_BUTTON, PANEL_PART } from './styles.ts'
import { useLiveDesign } from './use-live-design.ts'
import { useViewOnly } from './view-only.tsx'

/** What the card holds by the key it opens with: the Find field, which takes the focus. */
const FIND_FIELD = '[data-find-field]'
/** The card's body, whose own fields Ctrl+F goes back to Find from. */
const CARD = '[data-testid="find-replace"]'

/**
 * Ctrl+F (⌘F) opens the card, or goes back to its Find field, unless a field outside the card has
 * the keys: the browser's own find stays there.
 */
function useFindKey() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (shortcutFor(e) !== 'findReplace' || composingKey(e)) return
      const inCard = e.target instanceof Element && e.target.closest(CARD) !== null
      if (!inCard && (inField(e.target) || isStageField(e.target))) return
      e.preventDefault()
      if (editState().open !== 'findReplace') setOpen('findReplace')
      else document.querySelector<HTMLInputElement>(FIND_FIELD)?.select()
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [])
}

export function FindReplacePanel({ editor }: { editor: Editor }) {
  const t = useMessages()
  const { open } = useEditState()
  useFindKey()
  if (open !== 'findReplace') return null
  return (
    <PanelFrame id="findReplace" title={t.editor.findReplace.title} focus={false}>
      <FindReplace editor={editor} />
    </PanelFrame>
  )
}

/** The card's fields, what they find, and its two buttons. */
function FindReplace({ editor }: { editor: Editor }) {
  const t = useMessages()
  const f = t.editor.findReplace
  const locale = useLocale()
  const viewOnly = useViewOnly()
  const [find, setFind] = useState('')
  const [replace, setReplace] = useState('')
  // What the last Replace all did, with what it found after, said while Find finds the same: an
  // undo, or another change to the texts, ends it.
  const [said, setSaid] = useState<{ words: string; after: string } | null>(null)
  const findField = useRef<HTMLInputElement>(null)
  useEffect(() => findField.current?.focus({ preventScroll: true }), [])
  // Counted again as the design changes or another page is shown.
  const { version } = useLiveDesign(editor)
  const page = useShownPage(editor)
  const found = useMemo(() => editor.findText(find), [editor, find, version, page])

  const selectMatches = () => {
    if (found.layers.length > 0) editor.selectFound(find)
  }
  const replaceAll = () => {
    if (viewOnly || found.layers.length === 0) return
    const design = editor.design()
    const locked = found.layers.every((id) => design.nodes[id]?.lock?.content)
    const changed = editor.replaceText(find, replace)
    const words = changed > 0 ? counted(locale, f.replaced, changed) : locked ? f.allLocked : f.nothingReplaced
    setSaid({ words, after: JSON.stringify(editor.findText(find)) })
  }
  const onEnter = (run: () => void) => (e: ReactKeyboardEvent) => {
    if (e.key !== 'Enter' || composingKey(e.nativeEvent)) return
    e.preventDefault()
    run()
  }
  const saidNow = said && said.after === JSON.stringify(found) ? said.words : null
  // Find finds nothing: Daz searching says so in place of the count.
  const noMatch = saidNow === null && find !== '' && found.matches === 0
  const status =
    saidNow ??
    (find === ''
      ? null
      : noMatch
        ? format(t.editor.noMatch.title, { query: find })
        : `${counted(locale, f.matches, found.matches)} ${counted(locale, f.inTexts, found.layers.length)}`)
  return (
    <div className={PANEL_PART} data-testid="find-replace">
      <label className="flex flex-col gap-1.5">
        <span className={FIELD_LABEL}>{f.find}</span>
        <input
          ref={findField}
          data-find-field=""
          name="find"
          type="search"
          value={find}
          onChange={(e) => {
            setFind(e.target.value)
            setSaid(null)
          }}
          onKeyDown={onEnter(selectMatches)}
          className={cn(FIELD, 'px-2 font-sans text-small')}
        />
      </label>
      {!viewOnly && (
        <label className="flex flex-col gap-1.5">
          <span className={FIELD_LABEL}>{f.replace}</span>
          <input
            name="replace"
            type="text"
            value={replace}
            onChange={(e) => {
              setReplace(e.target.value)
              setSaid(null)
            }}
            onKeyDown={onEnter(replaceAll)}
            className={cn(FIELD, 'px-2 font-sans text-small')}
          />
        </label>
      )}
      <p
        aria-live="polite"
        className={cn('min-h-[18px] text-label text-muted', noMatch && 'sr-only')}
        data-testid="find-status"
      >
        {status}
      </p>
      {noMatch && (
        // The status line above says it to a screen reader.
        <div aria-hidden>
          <NoMatch query={find} className="py-2" />
        </div>
      )}
      <div className={cn('grid gap-1.5', viewOnly ? 'grid-cols-1' : 'grid-cols-2')}>
        <button
          type="button"
          disabled={found.layers.length === 0}
          onClick={selectMatches}
          className={cn(PANEL_BUTTON, 'justify-center')}
        >
          <span>{f.selectMatches}</span>
        </button>
        {!viewOnly && (
          <button
            type="button"
            disabled={found.layers.length === 0}
            onClick={replaceAll}
            className={cn(PANEL_BUTTON, 'justify-center')}
          >
            <span>{f.replaceAll}</span>
          </button>
        )}
      </div>
    </div>
  )
}
