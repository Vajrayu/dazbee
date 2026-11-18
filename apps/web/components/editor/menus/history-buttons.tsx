'use client'

// Undo and redo in the header pill, after the design's name: this tab's own changes, as their keys
// undo and redo them; each is off while there is nothing for it to do, and its tooltip names the
// step it would revert.
import { useSyncExternalStore } from 'react'

import type { StepName } from '@dazbee/doc'
import type { Editor } from '@dazbee/editor'

import { ArrowArcLeftIcon, ArrowArcRightIcon } from '@/components/ui/icons.tsx'
import { keyOf } from '@/lib/editor/shortcut-keys.ts'
import { useMessages } from '@/lib/i18n/client.tsx'
import { format } from '@/lib/i18n/index.ts'

/** What undo and redo would do: whether each can, and the name of the step each would revert. */
type History = [canUndo: boolean, undoName: StepName | null, canRedo: boolean, redoName: StepName | null]

const BUTTON =
  'grid size-7 shrink-0 cursor-pointer place-items-center rounded-full text-muted transition-colors duration-[var(--chrome-fast)] hover:bg-hover hover:text-text active:bg-pressed disabled:pointer-events-none disabled:opacity-35'
/** Nothing to undo or redo, as the page is drawn before the editor starts. */
const NOTHING = JSON.stringify([false, null, false, null] satisfies History)

/** What undo and redo would do now, as one value that changes whenever either does. */
const historyOf = (editor: Editor) =>
  JSON.stringify([editor.canUndo(), editor.undoName(), editor.canRedo(), editor.redoName()] satisfies History)

export function HistoryButtons({ editor }: { editor: Editor }) {
  const t = useMessages()
  const a = t.editor.actions
  const [canUndo, undoName, canRedo, redoName] = JSON.parse(
    useSyncExternalStore(
      (listener) => editor.onHistory(listener),
      () => historyOf(editor),
      () => NOTHING,
    ),
  ) as History
  /** A button's tooltip: its name, with the step it would revert when it has one, and its key. */
  const tip = (action: 'undo' | 'redo', step: StepName | null) =>
    format(t.editor.arrange.withKey, {
      label: step
        ? format(action === 'undo' ? t.editor.undoStep : t.editor.redoStep, { step: t.editor.steps[step] })
        : a[action],
      key: keyOf(action),
    })
  return (
    <div
      role="group"
      aria-label={`${a.undo}, ${a.redo}`}
      className="flex shrink-0 items-center border-s border-line ps-1"
    >
      <button
        type="button"
        aria-label={a.undo}
        title={tip('undo', undoName)}
        data-testid="undo"
        disabled={!canUndo}
        onClick={() => editor.perform('undo')}
        className={BUTTON}
      >
        <ArrowArcLeftIcon size={15} aria-hidden className="rtl:-scale-x-100" />
      </button>
      <button
        type="button"
        aria-label={a.redo}
        title={tip('redo', redoName)}
        data-testid="redo"
        disabled={!canRedo}
        onClick={() => editor.perform('redo')}
        className={BUTTON}
      >
        <ArrowArcRightIcon size={15} aria-hidden className="rtl:-scale-x-100" />
      </button>
    </div>
  )
}
