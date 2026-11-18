'use client'

import { useEffect, useId, useState } from 'react'

import {
  CloudArrowUpIcon,
  CloudCheckIcon,
  CloudSlashIcon,
  CloudWarningIcon,
  EyeIcon,
  type Icon,
} from '@/components/ui/icons.tsx'
import { FOCUS_RING } from '@/components/ui/looks.ts'
import { cn } from '@/lib/cn.ts'
import { useValue, type ValueStore } from '@/lib/editor/value-store.ts'
import { useMessages } from '@/lib/i18n/client.tsx'

import { setOpen, useEditState } from './edit-store.ts'

/**
 * The design's save state (#37) and how it shows: a small muted cloud while all is well (#110), so
 * it never competes with the work; a state that saves nothing to the server (Offline, a tab older
 * than the design, a deleted design, a tab open in another window, a member with no access) and an
 * error take the warning or danger colour and say so in words, with what to do beside them where
 * there is room. A Reviewer's tab reads View only, in words but uncoloured, since nothing is wrong.
 * It is the button that opens the Versions card, the design's version history, once the editor is ready.
 */
const SAVE: Record<string, { icon: Icon; tone: string; words?: boolean }> = {
  Saved: { icon: CloudCheckIcon, tone: 'text-subtle' },
  Saving: { icon: CloudArrowUpIcon, tone: 'text-subtle' },
  Offline: { icon: CloudSlashIcon, tone: 'text-warning', words: true },
  Outdated: { icon: CloudSlashIcon, tone: 'text-warning', words: true },
  Deleted: { icon: CloudWarningIcon, tone: 'text-warning', words: true },
  Replaced: { icon: CloudWarningIcon, tone: 'text-warning', words: true },
  NoAccess: { icon: CloudWarningIcon, tone: 'text-warning', words: true },
  ViewOnly: { icon: EyeIcon, tone: 'text-muted', words: true },
}
/** Saving stays up at least this long, so a quick edit doesn't flicker the badge. */
const SAVING_HOLD_MS = 600

/**
 * The status to show: the editor's own, except that Saving lingers a moment before Saved, so a
 * stream of edits reads as one save rather than a blink per keystroke.
 */
function useShownStatus(status: string) {
  const [shown, setShown] = useState(status)
  const [savingSince, setSavingSince] = useState(0)
  useEffect(() => {
    if (status === 'Saving' && shown !== 'Saving') {
      setSavingSince(Date.now())
      setShown(status)
      return
    }
    if (status === 'Saved' && shown === 'Saving') {
      const wait = savingSince + SAVING_HOLD_MS - Date.now()
      if (wait > 0) {
        const timer = setTimeout(() => setShown(status), wait)
        return () => clearTimeout(timer)
      }
    }
    setShown(status)
  }, [status, shown, savingSince])
  return shown
}

/**
 * The design's save state at the end of the start island, read from the status store, as the button
 * that opens the Versions card, or closes it.
 */
export function SaveStatus({ status, fitted }: { status: ValueStore<string>; fitted: boolean }) {
  const t = useMessages()
  const { open } = useEditState()
  const statusId = useId()
  const current = useValue(status)
  const shown = useShownStatus(current)
  const save = SAVE[shown]
  const failed = shown.startsWith('Error')
  return (
    <button
      type="button"
      aria-label={t.editor.versions.open}
      // The button names what it opens; the state it shows describes it.
      aria-describedby={statusId}
      aria-expanded={open === 'versions'}
      data-opens="versions"
      data-testid="versions-button"
      disabled={!fitted}
      onClick={() => setOpen(open === 'versions' ? null : 'versions')}
      className={cn(
        '-mx-1.5 flex shrink-0 cursor-pointer items-center rounded-full px-1.5 transition-colors duration-[var(--chrome-fast)] hover:bg-hover active:bg-pressed aria-expanded:bg-hover disabled:cursor-default disabled:hover:bg-transparent',
        FOCUS_RING,
      )}
    >
      <span
        id={statusId}
        role="status"
        aria-atomic="true"
        aria-label={t.editor.status}
        data-testid="status"
        data-status={current}
        data-ready={save && fitted ? '' : undefined}
        title={save ? t.editor.statusHint[shown] : undefined}
        className={cn(
          'flex h-7 shrink-0 items-center gap-1.5 text-tiny font-medium transition-colors duration-[var(--chrome)]',
          failed ? 'text-danger' : save ? save.tone : 'text-subtle',
        )}
      >
        {save ? (
          <save.icon size={17} aria-hidden className={cn(shown === 'Saving' && 'animate-pulse')} />
        ) : (
          <span aria-hidden className={cn('size-1.5 rounded-full', failed ? 'bg-danger' : 'animate-pulse bg-subtle')} />
        )}
        <span className={cn(!(failed || save?.words) && 'sr-only')}>{t.editor.statusText[shown] ?? shown}</span>
        {save?.words && <span className="hidden font-normal text-muted md:inline">{t.editor.statusHint[shown]}</span>}
      </span>
    </button>
  )
}
