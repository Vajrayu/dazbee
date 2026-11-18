'use client'

// This workspace's Invite, for an Owner or Admin: an email, the role it gives (Admin, Editor or Reviewer,
// a line under them saying what the one picked may do), for an Editor or Reviewer the brands they may see,
// and Invite. What the API answered shows under the form: to whom the invite was sent, or why it wasn't.
import { startTransition, useActionState, useState, useSyncExternalStore } from 'react'

import { type BrandSummary, INVITE_ROLES, type InviteRole } from '@dazbee/schema'

import { invite, type InviteAnswer } from '@/app/w/[workspaceId]/(workspace)/settings/actions.ts'
import { buttonStyles } from '@/components/ui/button.tsx'
import { CheckIcon, WarningCircleIcon } from '@/components/ui/icons.tsx'
import { SEGMENT, SEGMENTS } from '@/components/ui/looks.ts'
import { Radio, RadioGroup } from '@/components/ui/radio-group.tsx'
import { cn } from '@/lib/cn.ts'
import { useMessages } from '@/lib/i18n/client.tsx'
import { format } from '@/lib/i18n/index.ts'
import { canLimit } from '@/lib/settings-rights.ts'

import { BrandsChoice, type BrandsPick } from './brands-choice.tsx'

/** Nothing to listen to: whether the scripts have loaded never changes once they have. */
const subscribeNever = () => () => {}

export function InviteForm({
  workspaceId,
  brands,
  fromBrand,
}: {
  workspaceId: string
  /** The workspace's brands, to choose from. */
  brands: BrandSummary[]
  /** The brand Settings was opened from, which the brands choice starts at; else it starts at All brands. */
  fromBrand?: string | undefined
}) {
  const t = useMessages().settings
  const w = t.invite
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<InviteRole>('editor')
  const [pick, setPick] = useState<BrandsPick>(() =>
    fromBrand ? { all: false, ticked: [fromBrand] } : { all: true, ticked: [] },
  )
  // The email stays as typed when the invite is refused, to fix and send again, and empties once it is sent.
  const [answer, send, sending] = useActionState<InviteAnswer, FormData>(async (before, form) => {
    const answered = await invite(workspaceId, before, form)
    if (answered && 'sent' in answered) setEmail('')
    return answered
  }, null)
  // Whom an invite was sent to shows until the next email is typed; a refusal, until it is sent again.
  const shown = answer && ('error' in answer || !email) ? answer : null
  // False in the page as sent, true once its scripts run: Invite waits for them, so the browser never sends
  // the form itself.
  const loaded = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  )
  const emailRefused = shown !== null && 'error' in shown && shown.field !== 'brands'
  return (
    // Sent from the submit event rather than as the form's action, since React resets a form after its
    // action, and the reset would put the role and brands chosen back to where they started. Invite waits for
    // the scripts; were the form sent without them, it goes as a POST, so the email stays out of the address
    // bar.
    <form
      method="post"
      onSubmit={(event) => {
        event.preventDefault()
        const form = new FormData(event.currentTarget)
        startTransition(() => send(form))
      }}
      aria-labelledby="invite-title"
      data-testid="invite-form"
      className="mt-7 flex flex-col gap-2"
    >
      <h3 id="invite-title" className="text-label font-medium">
        {w.title}
      </h3>
      <div className="flex flex-wrap items-center gap-3">
        <input
          name="email"
          type="email"
          required
          maxLength={254}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-label={w.email}
          placeholder={w.emailPlaceholder}
          autoComplete="off"
          aria-invalid={emailRefused || undefined}
          aria-describedby={shown && (emailRefused || !('error' in shown)) ? 'invite-answer' : undefined}
          className="h-11 min-w-0 flex-1 basis-64 rounded-row border border-line bg-bg px-3 text-card outline-none hover:border-line-strong focus:border-accent"
        />
        <input type="hidden" name="role" value={role} />
        <RadioGroup label={w.role} options={INVITE_ROLES} value={role} onPick={setRole} className={SEGMENTS}>
          {INVITE_ROLES.map((each) => (
            <Radio key={each} value={each} className={cn(SEGMENT, 'h-9 px-3')}>
              {t.roles[each]}
            </Radio>
          ))}
        </RadioGroup>
        <button
          type="submit"
          disabled={sending || !loaded}
          className={cn(buttonStyles({ variant: 'primary', size: 'lg' }), 'h-11 px-7 font-semibold')}
        >
          {sending ? w.sending : w.send}
        </button>
      </div>
      <p className="text-label text-muted">{w.roleHints[role]}</p>
      {canLimit(role) && (
        <>
          <input type="hidden" name="brands" value={pick.all ? 'all' : 'chosen'} />
          {pick.ticked.map((id) => (
            <input key={id} type="hidden" name="brand" value={id} />
          ))}
          <BrandsChoice brands={brands} pick={pick} onPick={setPick} />
        </>
      )}
      {shown && <Answer answer={shown} sentWords={w.sent} />}
    </form>
  )
}

/** What the invite answered: sent, with a tick, or refused, in the danger colour. */
function Answer({ answer, sentWords }: { answer: NonNullable<InviteAnswer>; sentWords: string }) {
  const refused = 'error' in answer
  return (
    <p
      id="invite-answer"
      role={refused ? 'alert' : 'status'}
      data-testid="invite-answer"
      className={cn(
        'flex min-w-0 items-center gap-1.5 text-label [overflow-wrap:anywhere]',
        refused ? 'text-danger' : 'text-muted',
      )}
    >
      {refused ? (
        <WarningCircleIcon size={16} weight="bold" aria-hidden className="shrink-0" />
      ) : (
        <CheckIcon size={16} weight="bold" aria-hidden className="shrink-0 text-success" />
      )}
      <span className="min-w-0">{refused ? answer.error : format(sentWords, { email: answer.sent })}</span>
    </p>
  )
}
