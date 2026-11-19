// Settings' You part: what belongs to the person in every workspace. The language and the theme,
// each switched at once, and the workspaces they are in, each with its name, their role there and Leave;
// on the workspace they own, a note to hand over Owner first instead. Delete account sits at the bottom.
import Link from 'next/link'

import type { AccountDeletion, Me } from '@dazbee/schema'

import { LocaleSwitch } from '@/components/library/locale-switch.tsx'
import { ThemeSwitch } from '@/components/library/theme-switch.tsx'
import { TOUCH_ROW } from '@/components/ui/looks.ts'
import { workspacePath } from '@/lib/brand-routes.ts'
import { cn } from '@/lib/cn.ts'
import type { Messages } from '@/lib/i18n/index.ts'
import { canLeave } from '@/lib/settings-rights.ts'

import { DeleteAccount } from './delete-account.tsx'
import { LeaveWorkspace } from './leave-workspace.tsx'

export function YouPanel({
  t,
  workspaces,
  currentId,
  email,
  deletion,
}: {
  t: Messages
  /** The person's workspaces, by name, with their role in each. */
  workspaces: Me['workspaces']
  /** The workspace Settings was opened in. */
  currentId: string
  /** The person's email, which they type to delete their account. */
  email: string
  /** What deleting their account would delete, and the workspaces to hand over first. */
  deletion: AccountDeletion
}) {
  const s = t.settings
  return (
    <section
      aria-labelledby="you-title"
      data-testid="you-panel"
      className="rounded-[20px] border border-line bg-surface p-5 shadow-panel md:p-7"
    >
      <h2 id="you-title" className="font-display text-heading font-bold tracking-tight md:leading-tight">
        {s.you}
      </h2>
      <div className="mt-5 flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <span className="text-label font-medium">{t.language.label}</span>
          <LocaleSwitch />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <span className="text-label font-medium">{t.theme.label}</span>
          <ThemeSwitch />
        </div>
      </div>
      <h3 id="your-workspaces" className="mt-7 text-label font-medium">
        {s.yourWorkspaces}
      </h3>
      <ul aria-labelledby="your-workspaces" className="-mx-2 mt-2 flex flex-col gap-0.5">
        {workspaces.map((workspace) => {
          const on = workspace.id === currentId.toLowerCase()
          return (
            <li key={workspace.id} className="flex flex-wrap items-center gap-x-1 gap-y-0.5">
              <Link
                href={workspacePath(workspace.id)}
                aria-current={on ? 'true' : undefined}
                data-workspace={workspace.id}
                className={cn(
                  'flex h-10 min-w-0 flex-1 basis-48 items-center justify-between gap-3 rounded-row px-2 text-small transition-colors duration-[var(--chrome-fast)] hover:bg-hover',
                  on ? 'font-semibold text-text' : 'text-muted hover:text-text',
                  TOUCH_ROW,
                )}
              >
                <span className="min-w-0 truncate">{workspace.name}</span>
                <span className="shrink-0 text-label font-medium text-muted">{s.roles[workspace.role]}</span>
              </Link>
              {canLeave(workspace.role) ? (
                <LeaveWorkspace workspace={workspace} />
              ) : (
                <span className="shrink-0 px-2.5 text-caption text-subtle">{s.leave.ownerNote}</span>
              )}
            </li>
          )
        })}
      </ul>
      <DeleteAccount
        workspaceId={currentId}
        email={email}
        deletion={deletion}
        elsewhere={workspaces.some((workspace) => !deletion.deletes.some((deleted) => deleted.id === workspace.id))}
      />
    </section>
  )
}
