'use client'

// This workspace's Pending invites, for an Owner or Admin: each invite's email, role, an Editor's or
// Reviewer's brands and expiry, with Copy link, Resend and Revoke, in rows like the Pages card's, lit by a
// tint under the pointer and with no outlines. What a row's action did shows under that row: the link copied,
// or the invite sent again. A link the browser won't copy shows in the row to copy by hand. Why the API
// refused an action shows under the heading, so it stays when the invite has left the list, as one revoked in
// another tab has. Its note, done or refused, is the one the other parts of Settings show too.
import { useState, useTransition } from 'react'

import type { BrandSummary, Invite } from '@dazbee/schema'

import { resend, revoke } from '@/app/w/[workspaceId]/(workspace)/settings/actions.ts'
import { buttonStyles } from '@/components/ui/button.tsx'
import { cn } from '@/lib/cn.ts'
import { useLocale, useMessages } from '@/lib/i18n/client.tsx'
import { format } from '@/lib/i18n/index.ts'
import { canLimit } from '@/lib/settings-rights.ts'

import { brandsLabel } from './brands-choice.tsx'
import { Note } from './note.tsx'

/** What a row's last action did. */
type Answer = { done: string } | { link: string }

export function PendingInvites({
  workspaceId,
  invites,
  brands,
}: {
  workspaceId: string
  invites: Invite[]
  /** The workspace's brands, which name an invite's. */
  brands: BrandSummary[]
}) {
  const t = useMessages().settings
  // Why the API refused the last action, kept here rather than in its row, which may be gone.
  const [refusal, setRefusal] = useState<string | null>(null)
  if (invites.length === 0 && !refusal) return null
  return (
    <div data-testid="pending-invites">
      <h3 id="pending-title" className="mt-7 text-label font-medium">
        {t.pending.title}
      </h3>
      {refusal && <Note refused text={refusal} />}
      <ul aria-labelledby="pending-title" className="-mx-2 mt-2 flex flex-col gap-0.5">
        {invites.map((each) => (
          <InviteRow
            key={each.id}
            workspaceId={workspaceId}
            invite={each}
            brands={brands}
            onAct={() => setRefusal(null)}
            onRefused={(error) => setRefusal(format(t.pending.refused, { email: each.email, error }))}
          />
        ))}
      </ul>
    </div>
  )
}

/** One pending invite, with its actions and what the last of them did. */
function InviteRow({
  workspaceId,
  invite,
  brands,
  onAct,
  onRefused,
}: {
  workspaceId: string
  invite: Invite
  brands: BrandSummary[]
  /** Hears that an action started, so the last one's refusal goes. */
  onAct: () => void
  /** Hears why the API refused an action. */
  onRefused: (error: string) => void
}) {
  const t = useMessages().settings
  const p = t.pending
  const locale = useLocale()
  const [answer, setAnswer] = useState<Answer | null>(null)
  const [busy, startTransition] = useTransition()
  // In UTC, so the server and the browser draw the same date.
  const expires = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(invite.expiresAt),
  )

  function copy() {
    // A page the browser serves without its clipboard, such as one over plain http, shows the link instead.
    Promise.resolve()
      .then(() => navigator.clipboard.writeText(invite.link))
      .then(
        () => setAnswer({ done: p.copied }),
        () => setAnswer({ link: invite.link }),
      )
  }
  function act(change: (workspaceId: string, inviteId: string) => Promise<string | null>, done: string | null) {
    setAnswer(null)
    onAct()
    startTransition(async () => {
      const error = await change(workspaceId, invite.id)
      if (error) onRefused(error)
      else if (done) setAnswer({ done })
    })
  }

  const action = cn(buttonStyles({ variant: 'ghost', size: 'md' }), 'h-8 px-2.5 text-label font-semibold')
  return (
    <li
      data-invite={invite.email}
      aria-busy={busy || undefined}
      className="flex flex-col gap-1 rounded-row px-2 py-1.5 transition-colors duration-[var(--chrome-fast)] hover:bg-hover"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="flex min-w-0 flex-1 basis-48 flex-col">
          <span title={invite.email} className="truncate text-small font-semibold text-text">
            {invite.email}
          </span>
          <span className="text-caption text-subtle [overflow-wrap:anywhere]">
            {t.roles[invite.role]}
            {canLimit(invite.role) && ` · ${brandsLabel(invite.brandIds, brands, t.brands)}`} ·{' '}
            <time dateTime={invite.expiresAt}>{format(p.expires, { date: expires })}</time>
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            disabled={busy}
            onClick={copy}
            aria-label={format(p.copyLinkOf, { email: invite.email })}
            className={action}
          >
            {p.copyLink}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => act(resend, p.resent)}
            aria-label={format(p.resendTo, { email: invite.email })}
            className={action}
          >
            {p.resend}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => act(revoke, null)}
            aria-label={format(p.revokeFor, { email: invite.email })}
            className={cn(action, 'text-danger hover:text-danger')}
          >
            {p.revoke}
          </button>
        </span>
      </div>
      {answer && <RowAnswer answer={answer} linkLabel={format(p.copyLinkOf, { email: invite.email })} />}
    </li>
  )
}

/** What a row's action did: done, with a tick, or the link to copy by hand. */
function RowAnswer({ answer, linkLabel }: { answer: Answer; linkLabel: string }) {
  if ('link' in answer)
    return (
      <input
        name="invite-link"
        readOnly
        value={answer.link}
        aria-label={linkLabel}
        onFocus={(e) => e.currentTarget.select()}
        className="h-9 w-full rounded-row border border-line bg-bg px-2.5 font-mono text-caption text-text outline-none focus:border-accent"
      />
    )
  return <Note text={answer.done} />
}
