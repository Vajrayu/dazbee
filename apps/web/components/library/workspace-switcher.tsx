// The crumb's first part for a person in two or more workspaces: the workspace this page is in, with a
// menu of all of theirs by name, the current one ticked, each opening that workspace. A <details>, as
// the brand menu is, so it opens before any script loads.
import Link from 'next/link'

import type { WorkspaceSummary } from '@dazbee/schema'

import { CaretDownIcon, CheckIcon } from '@/components/ui/icons.tsx'
import { workspacePath } from '@/lib/brand-routes.ts'
import { cn } from '@/lib/cn.ts'
import type { Messages } from '@/lib/i18n/index.ts'

/** The name the crumb's menus share, so opening one closes the other. */
export const CRUMB_MENU = 'crumb-menu'

export function WorkspaceSwitcher({
  t,
  workspaces,
  currentId,
}: {
  t: Messages
  /** The person's workspaces, by name. */
  workspaces: readonly WorkspaceSummary[]
  /** The workspace this page is in. */
  currentId: string
}) {
  const current = workspaces.find((workspace) => workspace.id === currentId.toLowerCase())
  return (
    <details name={CRUMB_MENU} className="group relative min-w-0 shrink-[4]" data-testid="workspace-switcher">
      <summary
        aria-label={t.home.switchWorkspace}
        className="flex h-8 min-w-0 cursor-pointer list-none items-center gap-1 rounded-row px-1.5 text-muted transition-colors hover:bg-hover hover:text-text [&::-webkit-details-marker]:hidden"
      >
        <span className="max-w-48 min-w-0 truncate">{current?.name}</span>
        <CaretDownIcon size={12} weight="bold" aria-hidden className="transition-transform group-open:rotate-180" />
      </summary>
      <nav
        aria-label={t.home.workspaces}
        className="pop-in-start absolute start-0 top-full z-40 mt-2 flex w-64 flex-col gap-0.5 rounded-card surface-frost p-1.5"
      >
        {workspaces.map((workspace) => {
          const on = workspace.id === current?.id
          return (
            <Link
              key={workspace.id}
              href={workspacePath(workspace.id)}
              aria-current={on ? 'true' : undefined}
              className={cn(
                'flex h-10 items-center gap-2.5 rounded-row px-2 text-small transition-colors duration-[var(--chrome-fast)]',
                on ? 'bg-hover font-semibold text-text' : 'text-muted hover:bg-hover hover:text-text',
              )}
            >
              <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
              {on && <CheckIcon size={14} weight="bold" aria-hidden className="shrink-0" />}
            </Link>
          )
        })}
      </nav>
    </details>
  )
}
