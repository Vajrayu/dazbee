'use client'

// Every keyboard shortcut of the editor in one place, made from the shortcut table: its groups
// and rows in the table's order, with each key as this computer names it. It opens from the View
// card's keyboard button, with its own key anywhere but a text field, or from Quick actions, each
// through `shortcutsOpen`, which the dialog follows.
import { useEffect, useRef, useState } from 'react'

import { onMac, shortcutFor, type ShortcutGroup, shortcutsList } from '@dazbee/editor'
import { inField, isStageField } from '@dazbee/editor/dom-input'

import { useViewOnly } from '@/components/editor/view-only.tsx'
import { KeyboardIcon, XIcon } from '@/components/ui/icons.tsx'
import { TOUCH_SQUARE } from '@/components/ui/looks.ts'
import { overlayScroll } from '@/components/ui/overlay-scroll.ts'
import { cn } from '@/lib/cn.ts'
import { keyOf, keysOf } from '@/lib/editor/shortcut-keys.ts'
import { useValue, valueStore } from '@/lib/editor/value-store.ts'
import { useMessages } from '@/lib/i18n/client.tsx'
import { format } from '@/lib/i18n/index.ts'

/**
 * Where a column ends after a group, placed by hand so related groups sit together and the columns
 * come out even. Three columns from 1024 px wide (Edit, Text and Tools; Arrange, Combine shapes and
 * Linked frames; the rest), two from 640 px (Edit, Text, Tools and Arrange; the rest), one below.
 */
const COLUMN_ENDS: Partial<Record<ShortcutGroup, string>> = {
  tools: 'lg:break-after-column',
  arrange: 'sm:break-after-column lg:break-after-auto',
  linked: 'lg:break-after-column',
}
/** The list's groups and rows, from the table. */
const LISTED = shortcutsList()
/** What a tab that may only view lists: the keys that only look, select, copy or move the view (C35). */
const LISTED_VIEWING = shortcutsList({ viewOnly: true })
/** Whether the shortcuts list is open: its button, its key and Quick actions open it, and it closes itself. */
export const shortcutsOpen = valueStore(false)

export function ShortcutsButton({ className }: { className: string }) {
  const messages = useMessages().editor
  const viewOnly = useViewOnly()
  const t = messages.shortcuts
  const names = messages.actions
  const dialog = useRef<HTMLDialogElement>(null)
  const [mac, setMac] = useState(false)
  const open = useValue(shortcutsOpen)
  useEffect(() => {
    setMac(onMac())
    const onKey = (e: KeyboardEvent) => {
      // "?" typed into a text on the stage goes through the stage field, which may hear it first.
      if (shortcutFor(e) !== 'shortcuts' || inField(e.target) || isStageField(e.target)) return
      e.preventDefault()
      shortcutsOpen.set(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal()
    else if (!open && dialog.current?.open) dialog.current.close()
  }, [open])
  return (
    <>
      <button
        type="button"
        aria-label={names.shortcuts}
        title={format(messages.arrange.withKey, { label: names.shortcuts, key: keyOf('shortcuts') })}
        onClick={() => shortcutsOpen.set(true)}
        className={className}
      >
        <KeyboardIcon size={16} aria-hidden />
      </button>
      <dialog
        ref={dialog}
        aria-labelledby="shortcuts-title"
        data-testid="shortcuts"
        // A click on the backdrop, outside the panel, closes it. It shows while what holds its button
        // is hidden, as the phone's tab bar is under a sheet.
        onClick={(e) => e.target === e.currentTarget && e.currentTarget.close()}
        onClose={() => shortcutsOpen.set(false)}
        className="visible m-auto max-h-[min(80dvh,46rem)] w-[min(94vw,72rem)] overflow-hidden rounded-[20px] surface-frost p-0 text-text"
      >
        <div className="flex max-h-[inherit] flex-col">
          <div className="flex h-14 shrink-0 items-center gap-2 ps-6 pe-3">
            <h2 id="shortcuts-title" className="flex-1 font-display text-card font-bold tracking-tight">
              {t.title}
            </h2>
            <button
              type="button"
              aria-label={t.close}
              onClick={() => dialog.current?.close()}
              className={`grid size-8 ${TOUCH_SQUARE} cursor-pointer place-items-center rounded-full text-subtle hover:bg-hover hover:text-text active:bg-pressed`}
            >
              <XIcon size={16} aria-hidden />
            </button>
          </div>
          <div ref={overlayScroll} className="min-h-0 overflow-y-auto px-6 pb-6">
            <div className="columns-1 gap-8 sm:columns-2 lg:columns-3">
              {(viewOnly ? LISTED_VIEWING : LISTED).map(({ group, rows }) => (
                <section
                  key={group}
                  aria-labelledby={`shortcuts-${group}`}
                  className={cn('mb-5 break-inside-avoid', COLUMN_ENDS[group])}
                >
                  <h3
                    id={`shortcuts-${group}`}
                    className="mb-1.5 text-caption font-bold tracking-[0.08em] text-subtle uppercase"
                  >
                    {t.groups[group]}
                  </h3>
                  <dl className="flex flex-col">
                    {rows.map(({ action, keys }) => {
                      return (
                        <div
                          key={action}
                          data-shortcut={action}
                          className="flex items-center justify-between gap-3 border-t border-line py-1.5 first:border-t-0"
                        >
                          <dt className="min-w-0 text-small">{names[action]}</dt>
                          <dd className="flex shrink-0 flex-wrap justify-end gap-1.5" dir="ltr">
                            {keys.slice(0, 2).map((spec, n) => (
                              <span key={spec} className="flex items-center gap-0.5">
                                {n > 0 && <span className="pe-1 text-caption text-subtle">{t.or}</span>}
                                {keysOf(spec, mac).map((key, i) => (
                                  // A keycap: the well's tint with no outline, its key in the well's muted shade.
                                  <kbd
                                    key={i}
                                    className="min-w-6 rounded-[6px] bg-well px-1.5 py-0.5 text-center font-mono text-caption text-muted [--text-muted:var(--glass-well-muted)]"
                                  >
                                    {key}
                                  </kbd>
                                ))}
                              </span>
                            ))}
                          </dd>
                        </div>
                      )
                    })}
                  </dl>
                </section>
              ))}
            </div>
          </div>
        </div>
      </dialog>
    </>
  )
}
