'use client'

// The Versions card: the design's version history, opened from the save status or Quick actions, in
// the Pages card's look. It lists the versions newest first, each with the picture of its first
// frame, its title, who named it or Automatic, when, and its description on one line. A member whose
// role writes saves a version (Save version, or Ctrl+Alt+S), and renames or deletes one from its ⋯;
// a Reviewer only looks. A click on a version views it on the canvas, and its row shows selected
// while it does. The list is read as the card opens, after each change it makes, after a restore and
// when another member restores a version.
import { useCallback, useEffect, useState } from 'react'

import type { Editor } from '@dazbee/editor'
import { VERSION_LIMITS, type VersionSummary } from '@dazbee/schema'

import {
  deleteVersionFromEditor,
  renameVersionFromEditor,
  versionsOf,
} from '@/app/w/[workspaceId]/brands/[brandId]/designs/[designId]/actions.ts'
import { CardMenu } from '@/components/editor/card.tsx'
import { PanelFrame } from '@/components/editor/edit-panel/edit-panel.tsx'
import { setOpen, useEditState } from '@/components/editor/edit-store.ts'
import { PANEL_BUTTON, RENAME_IN_ROW } from '@/components/editor/styles.ts'
import { useViewOnly } from '@/components/editor/view-only.tsx'
import { Button } from '@/components/ui/button.tsx'
import { EmptyState } from '@/components/ui/empty-state.tsx'
import { PlusIcon } from '@/components/ui/icons.tsx'
import { FOCUS_RING } from '@/components/ui/looks.ts'
import { RenameField } from '@/components/ui/rename-field.tsx'
import { brandPath } from '@/lib/brand-routes.ts'
import { cn } from '@/lib/cn.ts'
import { useValue, type ValueStore } from '@/lib/editor/value-store.ts'
import {
  renamedTo,
  saveBlocked,
  versionByline,
  type VersionItems,
  versionItems,
  versionTitle,
} from '@/lib/editor/versions.ts'
import { useLocale, useMessages } from '@/lib/i18n/client.tsx'
import { counted, format } from '@/lib/i18n/index.ts'
import { usePhone } from '@/lib/phone.ts'

import { SaveVersionForm } from './save-version-form.tsx'
import { historyChanged, listed, saveAsked, useSaveVersionKey, viewing, viewVersion } from './use-versions.ts'

/** A version's row: rounded, no outline, tinted under the pointer, and lit while its version is viewed. */
const ROW =
  'flex items-center gap-2.5 rounded-[10px] p-1.5 transition-colors hover:tint-hover aria-[current]:bg-accent-soft aria-[current]:lit'

/**
 * The design's versions, read as the card opens, again on `reload`, after a restore and when another
 * member restores one; null until first read. A failure says so until the next change the card makes.
 */
function useVersionList(editor: Editor, workspaceId: string, brandId: string, designId: string) {
  const [versions, setVersions] = useState<VersionSummary[] | null>(null)
  const [failed, setFailed] = useState(false)
  const reload = useCallback(async () => {
    try {
      const read = await versionsOf(workspaceId, brandId, designId)
      setVersions(read)
      listed.set(read)
    } catch {
      setFailed(true)
    }
  }, [workspaceId, brandId, designId])
  useEffect(() => {
    void reload()
  }, [reload])
  useEffect(() => historyChanged.subscribe(() => void reload()), [reload])
  useEffect(() => {
    const stop = editor.onNotice((...[notice]) => {
      if (notice === 'restored') void reload()
    })
    return () => {
      stop()
    }
  }, [editor, reload])
  return { versions, failed, setFailed, reload }
}

export function VersionsPanel({
  editor,
  workspaceId,
  brandId,
  designId,
  status,
}: {
  editor: Editor
  workspaceId: string
  brandId: string
  designId: string
  /** The tab's save state: Save version is off while Offline, and waits until Saved. */
  status: ValueStore<string>
}) {
  const t = useMessages()
  const { open } = useEditState()
  const asked = useValue(saveAsked)
  useSaveVersionKey(editor)
  // The save form goes with the card.
  useEffect(() => {
    if (open !== 'versions') saveAsked.set(0)
  }, [open])
  if (open !== 'versions') return null
  return (
    // Opened for its form, the card leaves the focus to the form's name field.
    <PanelFrame id="versions" title={t.editor.versions.title} focus={asked === 0}>
      <VersionList
        editor={editor}
        workspaceId={workspaceId}
        brandId={brandId}
        designId={designId}
        status={status}
        asked={asked}
      />
    </PanelFrame>
  )
}

/** Save version or its form, then the versions newest first. */
function VersionList({
  editor,
  workspaceId,
  brandId,
  designId,
  status,
  asked,
}: {
  editor: Editor
  workspaceId: string
  brandId: string
  designId: string
  status: ValueStore<string>
  asked: number
}) {
  const locale = useLocale()
  const t = useMessages().editor
  const words = t.versions
  const { versions, failed, setFailed, reload } = useVersionList(editor, workspaceId, brandId, designId)
  const viewed = useValue(viewing)?.version.id
  const phone = usePhone()
  // What viewing a version said: it couldn't be fetched (for no version), or how many layers the read
  // left out (for the version, said while it shows).
  const [viewNote, setViewNote] = useState<{ text: string; forId: string | null } | null>(null)
  const view = async (version: VersionSummary) => {
    setViewNote(null)
    const outcome = await viewVersion(editor, version)
    if (outcome === 'stale') return
    if (outcome === 'failed') setViewNote({ text: words.notOpened, forId: null })
    else if (outcome.leftOut > 0)
      setViewNote({ text: counted(locale, t.notices.layersLeftOut, outcome.leftOut), forId: version.id })
    // On a phone the card covers the bar: it gives way once the version shows, unless it has more to say.
    else if (phone) setOpen(null)
  }
  // A Reviewer's tab, or one whose link ended, only looks.
  const items = versionItems(!useViewOnly())
  const saveState = useValue(status)
  const blocked = versions ? saveBlocked(saveState, versions) : null
  /** Runs a change the card makes, then reads the list again; a failure says so. */
  const change = async (run: () => Promise<unknown>) => {
    setFailed(false)
    try {
      await run()
    } catch {
      setFailed(true)
    }
    await reload()
  }

  return (
    <>
      {items.save && versions && asked === 0 && (
        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            disabled={blocked !== null}
            onClick={() => saveAsked.set(1)}
            data-testid="save-version-open"
            className={cn(PANEL_BUTTON, 'justify-center')}
          >
            <PlusIcon size={14} aria-hidden className="shrink-0" />
            <span>{words.save}</span>
          </button>
          {blocked && <p className="text-caption text-subtle">{words[blocked]}</p>}
        </div>
      )}
      {items.save && versions && asked > 0 && (
        <SaveVersionForm
          workspaceId={workspaceId}
          brandId={brandId}
          designId={designId}
          versions={versions}
          status={status}
          blocked={blocked}
          asked={asked}
          onDone={(saved) => {
            saveAsked.set(0)
            if (saved) void reload()
          }}
        />
      )}
      {failed && (
        <p role="alert" className="text-tiny text-danger">
          {words.failed}
        </p>
      )}
      {viewNote && (viewNote.forId === null || viewNote.forId === viewed) && (
        <p role="alert" className="text-tiny text-muted">
          {viewNote.text}
        </p>
      )}
      {versions === null ? (
        !failed && <p className="text-label text-subtle">{words.loading}</p>
      ) : versions.length === 0 ? (
        <EmptyState pose="clock" tight {...words.empty} />
      ) : (
        <ol aria-label={words.title} className="flex flex-col gap-0.5" data-testid="versions">
          {versions.map((version) => (
            <VersionRow
              key={version.id}
              version={version}
              items={items}
              viewed={viewed === version.id}
              onView={() => void view(version)}
              picture={brandPath(workspaceId, brandId, 'designs', designId, 'versions', version.id, 'thumbnail')}
              onRename={(name) =>
                change(() => renameVersionFromEditor(workspaceId, brandId, designId, version.id, name))
              }
              onRemove={() => change(() => deleteVersionFromEditor(workspaceId, brandId, designId, version.id))}
            />
          ))}
        </ol>
      )}
    </>
  )
}

/** One version: its picture, title, byline (wrapping, so the time always shows) and description; its ⋯ renames it in the row or deletes it once asked. */
function VersionRow({
  version,
  items,
  viewed,
  onView,
  picture,
  onRename,
  onRemove,
}: {
  version: VersionSummary
  items: VersionItems
  /** Whether the canvas shows this version now. */
  viewed: boolean
  onView: () => void
  picture: string
  onRename: (name: string) => Promise<void>
  onRemove: () => Promise<void>
}) {
  const locale = useLocale()
  const words = useMessages().editor.versions
  const [renaming, setRenaming] = useState(false)
  const [removing, setRemoving] = useState(false)
  // A version with no frame has no picture: its tile stays empty.
  const [pictureShown, setPictureShown] = useState(true)
  const title = versionTitle(version, words)
  const menu = [
    ...(items.rename ? [{ label: words.rename, run: () => setRenaming(true) }] : []),
    ...(items.remove ? [{ label: words.remove, danger: true, run: () => setRemoving(true) }] : []),
  ]
  return (
    <li data-version={version.id} className="flex flex-col">
      <div className={ROW} aria-current={viewed ? 'true' : undefined}>
        <span
          aria-hidden
          data-testid="version-thumbnail"
          className="grid h-10 w-14 shrink-0 place-items-center overflow-hidden rounded-[5px] bg-well"
        >
          {pictureShown && (
            <img
              src={picture}
              alt=""
              draggable={false}
              onError={() => setPictureShown(false)}
              className="max-h-full max-w-full object-contain"
            />
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          {renaming ? (
            <RenameField
              name={title}
              label={words.rename}
              inputName="version-name"
              maxLength={VERSION_LIMITS.nameChars}
              className={RENAME_IN_ROW}
              onDone={(name) => {
                setRenaming(false)
                const next = name === null ? null : renamedTo(version, name, words)
                if (next) void onRename(next)
              }}
            />
          ) : (
            <button
              type="button"
              onClick={onView}
              aria-label={format(words.view, { name: title })}
              aria-pressed={viewed}
              data-testid="version-view"
              className={cn(
                'cursor-pointer truncate rounded-[4px] text-start text-small font-semibold text-text',
                FOCUS_RING,
              )}
            >
              {title}
            </button>
          )}
          <span className="text-caption leading-snug text-subtle">{versionByline(locale, version, words)}</span>
          {version.description && (
            <span title={version.description} className="truncate text-caption text-muted">
              {version.description}
            </span>
          )}
        </span>
        {menu.length > 0 && <CardMenu label={format(words.more, { name: title })} items={menu} />}
      </div>
      {removing && (
        <div role="alertdialog" aria-label={words.remove} className="flex flex-col gap-2 px-1.5 pt-1 pb-2">
          <p className="text-label text-text">{format(words.confirmRemove, { name: title })}</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRemoving(false)}>
              {words.cancel}
            </Button>
            <Button
              variant="danger"
              data-testid="version-remove"
              onClick={() => {
                setRemoving(false)
                void onRemove()
              }}
            >
              {words.confirm}
            </Button>
          </div>
        </div>
      )}
    </li>
  )
}
