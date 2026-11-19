'use client'

// Delete account, at the bottom of Settings' You. It opens a part under it that says what goes: the
// workspaces the person owns alone, by name, and that what they made in other workspaces stays. They type
// their email to confirm, and once it is deleted, sign-in opens. While they own a workspace with other
// members, the part names those workspaces instead, each linking to its Members, to hand over Owner first.
import Link from 'next/link'
import { useId, useState, useTransition } from 'react'

import type { AccountDeletion } from '@dazbee/schema'

import { deleteMyAccount } from '@/app/w/[workspaceId]/(workspace)/settings/actions.ts'
import { buttonStyles } from '@/components/ui/button.tsx'
import { workspacePath } from '@/lib/brand-routes.ts'
import { cn } from '@/lib/cn.ts'
import { useLocale, useMessages } from '@/lib/i18n/client.tsx'
import { format } from '@/lib/i18n/index.ts'

import { Note } from './note.tsx'

const DANGER_GHOST = cn(
  buttonStyles({ variant: 'ghost', size: 'md' }),
  'h-9 px-3 text-label font-semibold text-danger hover:text-danger',
)

export function DeleteAccount({
  workspaceId,
  email,
  deletion,
  elsewhere,
}: {
  /** The workspace Settings was opened in, which draws again after a refusal. */
  workspaceId: string
  /** The person's email, which they type to confirm. */
  email: string
  deletion: AccountDeletion
  /** Whether they are a member of a workspace deleting keeps. */
  elsewhere: boolean
}) {
  const s = useMessages().settings.deleteAccount
  const locale = useLocale()
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [refusal, setRefusal] = useState<string | null>(null)
  const [busy, startTransition] = useTransition()
  const part = useId()
  const field = useId()
  const names = new Intl.ListFormat(locale, { type: 'conjunction' }).format(deletion.deletes.map((w) => w.name))
  const confirmed = typed.trim().toLowerCase() === email.toLowerCase()
  const close = () => {
    setOpen(false)
    setTyped('')
    setRefusal(null)
  }
  return (
    <div data-testid="delete-account" className="mt-7 border-t border-line pt-5">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={part}
        onClick={() => (open ? close() : setOpen(true))}
        className={cn(DANGER_GHOST, '-ms-3')}
      >
        {s.open}
      </button>
      {open && (
        <div id={part} className="mt-3 flex max-w-xl flex-col gap-3">
          {deletion.handOver.length > 0 ? (
            <>
              <p className="text-small leading-snug">{s.handOverFirst}</p>
              <ul className="flex flex-col gap-1">
                {deletion.handOver.map((workspace) => (
                  <li key={workspace.id}>
                    <Link
                      href={`${workspacePath(workspace.id, 'settings')}#members-title`}
                      className="text-small font-medium text-accent-text [overflow-wrap:anywhere] hover:underline"
                    >
                      {format(s.membersOf, { workspace: workspace.name })}
                    </Link>
                  </li>
                ))}
              </ul>
              <div>
                <button type="button" onClick={close} className={cn(buttonStyles({ variant: 'ghost' }), 'h-9 px-3')}>
                  {s.cancel}
                </button>
              </div>
            </>
          ) : (
            <form
              className="flex flex-col gap-3"
              onSubmit={(event) => {
                event.preventDefault()
                if (!confirmed || busy) return
                setRefusal(null)
                const deletes = deletion.deletes.map((workspace) => workspace.id)
                startTransition(async () => setRefusal(await deleteMyAccount(workspaceId, { email: typed, deletes })))
              }}
            >
              <p className="text-small leading-snug [overflow-wrap:anywhere]">
                {deletion.deletes.length === 0
                  ? s.deletesNone
                  : format(deletion.deletes.length === 1 ? s.deletesOne : s.deletesMany, { workspaces: names })}
                {elsewhere && ` ${s.othersStay}`}
              </p>
              <label htmlFor={field} className="text-label font-medium [overflow-wrap:anywhere]">
                {format(s.typeEmail, { email })}
              </label>
              <input
                id={field}
                type="email"
                dir="ltr"
                autoComplete="off"
                spellCheck={false}
                autoFocus
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                maxLength={320}
                className="h-11 min-w-0 rounded-row border border-line bg-bg px-3 text-card outline-none hover:border-line-strong focus:border-accent"
              />
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="submit"
                  disabled={!confirmed || busy}
                  className={cn(buttonStyles({ variant: 'danger', size: 'lg' }), 'h-10 px-5 font-semibold')}
                >
                  {busy ? s.deleting : s.confirm}
                </button>
                <button type="button" onClick={close} className={cn(buttonStyles({ variant: 'ghost' }), 'h-10 px-3')}>
                  {s.cancel}
                </button>
              </div>
              {refusal && <Note refused text={refusal} />}
            </form>
          )}
        </div>
      )}
    </div>
  )
}
