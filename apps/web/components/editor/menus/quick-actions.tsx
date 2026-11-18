'use client'

// Quick actions: every action that can run now, found by its name. Ctrl+K or Ctrl+/ (⌘ on a Mac)
// opens it outside a field, the stage field and another dialog, and the editor page keeps those keys
// from the browser everywhere, so Ctrl+K never goes to the address bar. Which actions can run is
// worked out once, as it opens: it is modal, so the selection can't change under it. A row runs its action as its key does, one undo step.
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'

import { type Editor, goInWay, onMac, type ShortcutAction, shortcutFor } from '@dazbee/editor'
import { composingKey, inField, isStageField, stageHasKeys } from '@dazbee/editor/dom-input'

import { pickFromPanel } from '@/components/editor/edit-panel/eyedropper.tsx'
import { setOpen, toggleFlyout } from '@/components/editor/edit-store.ts'
import { shortcutsOpen } from '@/components/editor/menus/shortcuts-dialog.tsx'
import { askSaveVersion, showVersions } from '@/components/editor/versions/use-versions.ts'
import { NoMatch } from '@/components/ui/empty-state.tsx'
import { MagnifyingGlassIcon } from '@/components/ui/icons.tsx'
import { TOUCH_FIELD } from '@/components/ui/looks.ts'
import { cn } from '@/lib/cn.ts'
import { fold } from '@/lib/editor/action-search.ts'
import { groupOf, LISTED_ACTIONS, quickActionsList } from '@/lib/editor/quick-actions-list.ts'
import { recentActions } from '@/lib/editor/recent-actions.ts'
import { firstKeyOf, keysOf, type SelectedLayers } from '@/lib/editor/shortcut-keys.ts'
import { useLocale, useMessages } from '@/lib/i18n/client.tsx'
import { CATALOGS, counted, format } from '@/lib/i18n/index.ts'
import { usePhone } from '@/lib/phone.ts'

/** What it found as it opened: the actions that can run now, those run lately, and the selected layers they run on. */
interface Opened {
  ready: readonly ShortcutAction[]
  recent: readonly ShortcutAction[]
  on: SelectedLayers
}

/** The phone's tool tray (`useToolTray`). */
interface Tray {
  open: boolean
  setOpen: (open: boolean) => void
  box: RefObject<HTMLDivElement | null>
  button: RefObject<HTMLButtonElement | null>
}

/** The actions run lately from here, on this device. */
const RECENT = recentActions(() => window.localStorage)

/** Whether another dialog is open over the page, such as Keyboard shortcuts: its keys are its own. */
function otherDialogOpen() {
  return document.querySelector('dialog[open]') !== null
}

/** Lets the focus go to the page, where the stage has the keys. */
function letGo() {
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
}

/** The dialog, opened by its keys; `tray` is the phone's tool tray. */
export function QuickActions({ editor, tray }: { editor: Editor | null; tray: Tray }) {
  const t = useMessages()
  const locale = useLocale()
  const phone = usePhone()
  const q = t.editor.quickActions
  const names = t.editor.actions
  const id = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const opener = useRef<Element | null>(null)
  const [opened, setOpened] = useState<Opened | null>(null)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [mac, setMac] = useState(false)

  const open = (from: Element | null) => {
    const shown = dialog.current
    if (!editor || !shown || shown.open) return
    opener.current = from
    setOpened({
      ready: LISTED_ACTIONS.filter((action) => editor.actionReady(action)),
      recent: RECENT.list(),
      on: { design: editor.design(), ids: editor.selection() },
    })
    setQuery('')
    setActive(0)
    shown.showModal()
    search.current?.focus()
  }

  // The listener reaches the latest `open`, bound once.
  const opening = useRef(open)
  useEffect(() => {
    opening.current = open
  })
  useEffect(() => setMac(onMac()), [])
  // Kept from the browser in a capture listener, before any field or pop-up can stop the key.
  useEffect(() => {
    const here = (from: Element | null) => opening.current(from)
    const onKey = (e: KeyboardEvent) => {
      if (shortcutFor(e) !== 'quickActions' || composingKey(e)) return
      e.preventDefault()
      if (inField(e.target) || isStageField(e.target) || otherDialogOpen()) return
      here(document.activeElement)
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => {
      window.removeEventListener('keydown', onKey, { capture: true })
    }
  }, [])

  const sections = useMemo(() => {
    if (!opened) return []
    return quickActionsList({
      ready: opened.ready,
      recent: opened.recent,
      query,
      names,
      ...(locale === 'ar' && { english: CATALOGS.en.editor.actions }),
      headings: { recent: q.recent, groups: t.editor.shortcuts.groups },
    })
  }, [opened, query, names, locale, q.recent, t.editor.shortcuts.groups])
  const rows = sections.flatMap((section) => section.rows)

  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  /**
   * Gives the focus back, then closes. Opened while the stage had the keys, the search lets the focus
   * go, so the next key is the stage's at once; else the focus goes back to what opened it. Running an
   * action from the tool tray closes the tray as picking a tool does, its button taking the focus.
   * Go in on a text lets the focus go wherever it opened, so the stage field takes it and the next
   * key types.
   */
  const close = (running: ShortcutAction | null) => {
    const from = opener.current
    const inTray = tray.open && from !== null && tray.box.current?.contains(from) === true
    const types = running === 'goIn' && opened !== null && goInWay(opened.on.design, opened.on.ids) === 'type'
    const closesTray = running !== null && inTray
    if (closesTray) tray.setOpen(false)
    if (!types) {
      if (closesTray) tray.button.current?.focus()
      else if (from instanceof HTMLElement && from.isConnected && !stageHasKeys(from)) from.focus()
      else letGo()
    }
    dialog.current?.close()
    // A modal dialog gives the focus back to its opener as it closes, so typing's is let go after.
    if (types) letGo()
    setOpened(null)
  }

  /** Closes, then runs the action in the same handler, so the browser's own focus return never comes after it. */
  const run = (action: ShortcutAction) => {
    close(action)
    RECENT.record(action)
    if (!editor) return
    switch (action) {
      case 'copy':
        if (!document.execCommand('copy')) editor.copyLayers()
        break
      case 'copyPng':
        editor.copyPng()
        break
      case 'cut':
        document.execCommand('cut')
        break
      case 'paste':
        editor.pasteLayers()
        break
      case 'shortcuts':
        shortcutsOpen.set(true)
        break
      case 'findReplace':
        setOpen('findReplace')
        break
      case 'saveVersion':
        askSaveVersion()
        break
      case 'showVersions':
        showVersions()
        break
      case 'assets':
        toggleFlyout('assets', phone)
        break
      case 'pickColour':
        pickFromPanel(editor)
        break
      case 'quickActions':
        break
      default:
        editor.perform(action)
    }
  }

  const onKey = (e: ReactKeyboardEvent) => {
    if (composingKey(e.nativeEvent)) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActive((at) => Math.min(Math.max(at + step, 0), Math.max(rows.length - 1, 0)))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const action = rows[active]
      if (action) run(action)
    } else if (e.key === 'Escape' || shortcutFor(e.nativeEvent) === 'quickActions') {
      e.preventDefault()
      close(null)
    }
  }

  const searching = fold(query) !== ''
  const status =
    searching && rows.length === 0
      ? format(t.editor.noMatch.title, { query: query.trim() })
      : counted(locale, q.count, rows.length)
  const listId = `${id}-list`
  const option = (action: ShortcutAction, index: number, grouped: boolean) => {
    const group = groupOf(action)
    const key = opened ? firstKeyOf(action, opened.on) : undefined
    return (
      <div
        key={action}
        id={`${id}-${index}`}
        role="option"
        aria-selected={index === active}
        data-index={index}
        onPointerMove={() => index !== active && setActive(index)}
        onClick={() => run(action)}
        className={cn(
          'flex h-9 cursor-pointer items-center gap-3 rounded-row px-2.5 text-small aria-selected:bg-hover aria-selected:lit',
          TOUCH_FIELD,
        )}
      >
        <span className="min-w-0 flex-1 truncate">
          <span className="font-medium text-text">{names[action]}</span>
          {/* Two rows read "Box", the tool and the action, so a row away from its group's heading names it. */}
          {!grouped && group && <span className="ms-2 text-label text-subtle">{t.editor.shortcuts.groups[group]}</span>}
        </span>
        {key && (
          // A phone has no keyboard, so its rows leave the keys out, as the menus do.
          <span dir="ltr" className="flex shrink-0 gap-0.5 max-sm:hidden">
            {keysOf(key, mac).map((cap, i) => (
              <kbd
                key={i}
                className="min-w-6 rounded-[6px] bg-well px-1.5 py-0.5 text-center font-mono text-caption text-muted [--text-muted:var(--glass-well-muted)]"
              >
                {cap}
              </kbd>
            ))}
          </span>
        )}
      </div>
    )
  }

  let index = 0
  return (
    <dialog
      ref={dialog}
      aria-label={names.quickActions}
      // Esc where the search doesn't have it, or the system's back, closes it as Esc in the search does.
      onCancel={(e) => {
        e.preventDefault()
        close(null)
      }}
      // A click on the backdrop, outside the panel, closes it.
      onClick={(e) => e.target === e.currentTarget && close(null)}
      // A press on a row, a heading or the status line leaves the focus in the search, so the arrows,
      // typing and Ctrl+K go on working there.
      onPointerDown={(e) => e.target !== search.current && e.preventDefault()}
      className="visible mx-auto mt-[5.5rem] mb-auto w-[min(36rem,100vw-24px)] overflow-hidden rounded-[20px] surface-frost p-0 text-text"
    >
      <div className="flex max-h-[min(32rem,calc(100dvh-7rem))] flex-col">
        <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-line px-4 max-sm:h-13">
          <MagnifyingGlassIcon size={16} aria-hidden className="shrink-0 text-subtle" />
          <input
            ref={search}
            name="quick-actions-search"
            type="search"
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={rows[active] ? `${id}-${active}` : undefined}
            aria-label={q.search}
            placeholder={q.search}
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(0)
            }}
            onKeyDown={onKey}
            className="h-full min-w-0 flex-1 bg-transparent text-card outline-none placeholder:text-subtle focus-visible:outline-none! [&::-webkit-search-cancel-button]:hidden"
          />
        </div>
        <div
          ref={list}
          id={listId}
          role="listbox"
          aria-label={names.quickActions}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5"
        >
          {sections.map((section) => {
            const options = section.rows.map((action) =>
              option(action, index++, section.id !== 'recent' && !!section.heading),
            )
            if (!section.heading) return options
            return (
              <div key={section.id} role="group" aria-labelledby={`${id}-${section.id}`} className="pb-1">
                <div
                  id={`${id}-${section.id}`}
                  className="px-2.5 pt-2 pb-1 text-caption font-bold tracking-[0.08em] text-subtle uppercase"
                >
                  {section.heading}
                </div>
                {options}
              </div>
            )
          })}
          {searching && rows.length === 0 && (
            // The status line under the list says it to a screen reader.
            <div aria-hidden>
              <NoMatch query={query.trim()} />
            </div>
          )}
        </div>
        <p
          role="status"
          className={cn(
            'shrink-0 border-t border-line px-4 py-2 text-caption text-subtle',
            searching && rows.length === 0 && 'sr-only',
          )}
        >
          {status}
        </p>
      </div>
    </dialog>
  )
}
