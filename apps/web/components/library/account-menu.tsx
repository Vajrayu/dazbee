'use client'

// The round avatar at the top end, as in the final mock: the person's own initials, opening to
// Settings and Sign out, so the top bar keeps to the work and one action. In the editor its menu
// stands over the edit panel: Esc closes it first, and never clears the selection.
import Link from 'next/link'
import { useId, useState } from 'react'

import { GearSixIcon, SignOutIcon } from '@/components/ui/icons.tsx'
import { TOUCH_ROW } from '@/components/ui/looks.ts'
import { useMenuClose } from '@/components/ui/menu-close.ts'
import { workspacePath } from '@/lib/brand-routes.ts'
import { useMessages } from '@/lib/i18n/client.tsx'
import { initialsOf } from '@/lib/initials.ts'

const ROW = `flex h-10 w-full cursor-pointer items-center gap-3 rounded-row px-3 text-start text-small font-medium transition-colors duration-[var(--chrome-fast)] hover:bg-hover hover:lit active:bg-pressed active:lit focus-visible:bg-hover focus-visible:lit focus-visible:outline-none ${TOUCH_ROW}`

export function AccountMenu({
  workspaceId,
  name,
  signedIn,
}: {
  /** The workspace whose Settings the menu opens. */
  workspaceId: string
  /** The person's name, shown as the avatar's initials. */
  name: string
  /** Whether there is a session to end, so Sign out shows (#58). */
  signedIn: boolean
}) {
  const t = useMessages()
  const [open, setOpen] = useState(false)
  // Closes on Esc, before what is under it, or a press outside, giving the focus back to the avatar.
  const { box, button, overPanelMark } = useMenuClose(open, () => setOpen(false))
  const id = useId()

  return (
    <div ref={box} {...overPanelMark} className="relative">
      <button
        ref={button}
        type="button"
        aria-label={t.account.open}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        data-testid="account-open"
        className="grid size-9 cursor-pointer place-items-center rounded-full bg-[image:var(--ai-gradient)] text-small font-bold text-white shadow-[0_0_0_2px_var(--color-bg)] transition-transform duration-[var(--chrome-fast)] hover:scale-105"
      >
        <span aria-hidden>{initialsOf(name)}</span>
      </button>
      {open && (
        <div
          id={id}
          role="dialog"
          aria-label={t.account.open}
          data-testid="account"
          className="pop-in-end absolute end-0 top-full z-40 mt-2 flex w-56 flex-col gap-0.5 rounded-card surface-frost p-1.5"
        >
          <AccountRows workspaceId={workspaceId} signedIn={signedIn} />
        </div>
      )}
    </div>
  )
}

/** What the open menu holds: Settings, and Sign out while there is a session to end. */
export function AccountRows({ workspaceId, signedIn }: { workspaceId: string; signedIn: boolean }) {
  const t = useMessages()
  return (
    <>
      <Link href={workspacePath(workspaceId, 'settings')} className={ROW} data-testid="settings-link">
        <GearSixIcon size={18} aria-hidden className="text-muted" />
        {t.account.settings}
      </Link>
      {signedIn && (
        <form action="/logout" method="post">
          <button type="submit" className={ROW} data-testid="sign-out">
            <SignOutIcon size={18} aria-hidden className="text-muted rtl:-scale-x-100" />
            {t.signIn.signOut}
          </button>
        </form>
      )}
    </>
  )
}
