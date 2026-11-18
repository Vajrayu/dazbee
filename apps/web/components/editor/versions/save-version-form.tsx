'use client'

// The Versions card's save form: a name and an optional description, Save and Cancel; Enter saves.
// A name left empty is sent as "Version N" in the page's language. Saving first waits until the tab
// is Saved, since the API takes a named version from the design as stored, then saves.
import { type KeyboardEvent, useEffect, useRef, useState } from 'react'

import { VERSION_LIMITS, type VersionSummary } from '@dazbee/schema'

import { saveVersionFromEditor } from '@/app/w/[workspaceId]/brands/[brandId]/designs/[designId]/actions.ts'
import { FIELD, FIELD_LABEL } from '@/components/editor/styles.ts'
import { Button } from '@/components/ui/button.tsx'
import type { ValueStore } from '@/lib/editor/value-store.ts'
import { type SaveBlocked, savedName, whenSaved } from '@/lib/editor/versions.ts'
import { useMessages } from '@/lib/i18n/client.tsx'

/** Why the form saved nothing: a reason Save version is off, or the history out of reach. */
type Refusal = SaveBlocked | 'failed'

export function SaveVersionForm({
  workspaceId,
  brandId,
  designId,
  versions,
  status,
  blocked,
  asked,
  onDone,
}: {
  workspaceId: string
  brandId: string
  designId: string
  /** The versions listed, which number an unnamed one. */
  versions: readonly VersionSummary[]
  /** The tab's save state, which a save waits on until Saved. */
  status: ValueStore<string>
  /** Why Save is off now, if it is: Offline, a tab that saves nothing, or a full history. */
  blocked: SaveBlocked | null
  /** How many times the form was asked for: the name field takes the focus each time. */
  asked: number
  /** The form is done: `saved` when it saved a version. */
  onDone: (saved: boolean) => void
}) {
  const words = useMessages().editor.versions
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [refusal, setRefusal] = useState<Refusal | null>(null)
  const nameField = useRef<HTMLInputElement>(null)
  useEffect(() => {
    nameField.current?.focus()
  }, [asked])

  const save = async () => {
    if (saving || blocked) return
    setSaving(true)
    setRefusal(null)
    try {
      const ready = await whenSaved(status)
      if (ready !== 'saved') return setRefusal(ready)
      const saved = await saveVersionFromEditor(
        workspaceId,
        brandId,
        designId,
        savedName(name, words, versions),
        description.trim(),
      )
      if (saved === 'full') return setRefusal('full')
      onDone(true)
    } catch {
      setRefusal('failed')
    } finally {
      setSaving(false)
    }
  }
  // Enter saves from either field; Shift+Enter starts a new line in the description.
  const enterSaves = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    void save()
  }

  return (
    <form
      data-testid="save-version"
      className="flex flex-col gap-2.5"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <label className="flex flex-col gap-1.5">
        <span className={FIELD_LABEL}>{words.name}</span>
        <input
          ref={nameField}
          name="version-name"
          value={name}
          placeholder={savedName('', words, versions)}
          maxLength={VERSION_LIMITS.nameChars}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={enterSaves}
          className={FIELD}
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className={FIELD_LABEL}>{words.description}</span>
        <textarea
          name="version-description"
          value={description}
          rows={2}
          maxLength={VERSION_LIMITS.descriptionChars}
          onChange={(event) => setDescription(event.target.value)}
          onKeyDown={enterSaves}
          className={`${FIELD} h-auto resize-none py-1.5 font-sans text-small`}
        />
      </label>
      {(blocked ?? refusal) && (
        <p role="alert" className="text-tiny text-danger">
          {words[blocked ?? refusal ?? 'failed']}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => onDone(false)}>
          {words.cancel}
        </Button>
        <Button type="submit" variant="primary" disabled={saving || blocked !== null} data-testid="save-version-save">
          {saving ? words.saving : words.save}
        </Button>
      </div>
    </form>
  )
}
