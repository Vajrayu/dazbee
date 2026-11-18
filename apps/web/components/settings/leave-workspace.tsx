'use client'

// Leave on one of Your workspaces, which asks once in a small menu; once the person has left, the
// workspace to open opens, or with none left they are signed out. Why the API refused shows under the row.
import { useState, useTransition } from 'react'

import { leave } from '@/app/w/[workspaceId]/(workspace)/settings/actions.ts'
import { buttonStyles } from '@/components/ui/button.tsx'
import { cn } from '@/lib/cn.ts'
import { useMessages } from '@/lib/i18n/client.tsx'
import { format } from '@/lib/i18n/index.ts'

import { ConfirmMenu } from './confirm-menu.tsx'
import { Note } from './note.tsx'

export function LeaveWorkspace({ workspace }: { workspace: { id: string; name: string } }) {
  const s = useMessages().settings
  const [refusal, setRefusal] = useState<string | null>(null)
  const [busy, startTransition] = useTransition()
  const label = format(s.leave.leaveFor, { workspace: workspace.name })
  return (
    <>
      <ConfirmMenu
        trigger={
          <button
            type="button"
            disabled={busy}
            aria-label={label}
            className={cn(
              buttonStyles({ variant: 'ghost', size: 'md' }),
              'h-8 shrink-0 px-2.5 text-label font-semibold text-danger hover:text-danger',
            )}
          >
            {s.leave.leave}
          </button>
        }
        label={label}
        question={format(s.leave.confirm, { workspace: workspace.name })}
        confirm={s.leave.leave}
        cancel={s.leave.cancel}
        danger
        onConfirm={() => {
          setRefusal(null)
          startTransition(async () => setRefusal(await leave(workspace.id)))
        }}
      />
      {refusal && (
        <div className="basis-full px-2">
          <Note refused text={refusal} />
        </div>
      )}
    </>
  )
}
