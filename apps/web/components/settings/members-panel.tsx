'use client'

// This workspace's Members: each member's initials, name, email and role, from Owner down, in rows like
// the Pages card's, lit by a tint under the pointer and with no outlines. An Owner or Admin sees, on every
// other member's row but the Owner's, the role as a menu that changes it and Remove; the Owner also sees
// Hand over Owner on an Admin's row. Remove and Hand over each ask once, in a small menu. Why the API
// refused a change shows under the heading, so it stays when the member has left the list.
import { useState, useTransition } from 'react'

import { INVITE_ROLES, type InviteRole, type MemberRole, type WorkspaceMember } from '@dazbee/schema'

import { changeRole, handOver, remove } from '@/app/w/[workspaceId]/(workspace)/settings/actions.ts'
import { buttonStyles } from '@/components/ui/button.tsx'
import { CaretDownIcon, CheckIcon } from '@/components/ui/icons.tsx'
import { Menu, MenuRadio, MenuRadios } from '@/components/ui/menu.tsx'
import { cn } from '@/lib/cn.ts'
import { useMessages } from '@/lib/i18n/client.tsx'
import { format } from '@/lib/i18n/index.ts'
import { initialsOf } from '@/lib/initials.ts'
import { type RowControls, rowControls } from '@/lib/settings-rights.ts'

import { ConfirmMenu } from './confirm-menu.tsx'
import { Note } from './note.tsx'

/** A change a row makes to its member, which gives why the API refused it, or null. */
type MemberChange = () => Promise<string | null>

/** The words a row's member goes by: their name, else their email. */
const nameOf = (member: WorkspaceMember) => member.name || member.email

export function MembersPanel({
  workspaceId,
  members,
  viewerId,
  viewerRole,
}: {
  workspaceId: string
  members: WorkspaceMember[]
  /** The person looking, whose own row shows no controls. */
  viewerId: string
  viewerRole: MemberRole
}) {
  const s = useMessages().settings
  // Why the API refused the last change, kept here rather than in its row, which may be gone.
  const [refusal, setRefusal] = useState<string | null>(null)
  return (
    <div data-testid="members">
      <h3 id="members-title" className="mt-7 text-label font-medium">
        {s.members}
      </h3>
      {refusal && <Note refused text={refusal} />}
      <ul aria-labelledby="members-title" className="-mx-2 mt-2 flex flex-col gap-0.5">
        {members.map((member) => (
          <MemberRow
            key={member.id}
            workspaceId={workspaceId}
            member={member}
            controls={rowControls(viewerRole, member.role, member.id === viewerId)}
            onAct={() => setRefusal(null)}
            onRefused={(error) => setRefusal(format(s.member.refused, { name: nameOf(member), error }))}
          />
        ))}
      </ul>
    </div>
  )
}

/** One member, with the controls the viewer sees on their row. */
function MemberRow({
  workspaceId,
  member,
  controls,
  onAct,
  onRefused,
}: {
  workspaceId: string
  member: WorkspaceMember
  controls: RowControls
  /** Hears that a change started, so the last one's refusal goes. */
  onAct: () => void
  /** Hears why the API refused a change. */
  onRefused: (error: string) => void
}) {
  const s = useMessages().settings
  const m = s.member
  const name = nameOf(member)
  const [busy, startTransition] = useTransition()

  function act(change: MemberChange) {
    onAct()
    startTransition(async () => {
      const error = await change()
      if (error) onRefused(error)
    })
  }

  const action = cn(buttonStyles({ variant: 'ghost', size: 'md' }), 'h-8 px-2.5 text-label font-semibold')
  return (
    <li
      data-member={member.email}
      aria-busy={busy || undefined}
      className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 rounded-row px-2 py-1.5 transition-colors duration-[var(--chrome-fast)] hover:bg-hover"
    >
      <span className="flex min-w-0 flex-1 basis-48 items-center gap-3">
        <span
          aria-hidden
          className="grid size-8 shrink-0 place-items-center rounded-full bg-well text-caption font-semibold text-muted"
        >
          {initialsOf(name)}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span title={name} className="truncate text-small font-semibold text-text">
            {name}
          </span>
          {member.name && (
            <span title={member.email} className="truncate text-caption text-subtle">
              {member.email}
            </span>
          )}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-0.5">
        {controls.role ? (
          <RoleMenu
            role={member.role}
            name={name}
            busy={busy}
            onPick={(role) => act(() => changeRole(workspaceId, member.id, role))}
          />
        ) : (
          <span className="px-2.5 text-label font-medium text-muted">{s.roles[member.role]}</span>
        )}
        {controls.handOver && (
          <ConfirmMenu
            trigger={
              <button type="button" disabled={busy} aria-label={format(m.handOverTo, { name })} className={action}>
                {m.handOver}
              </button>
            }
            label={format(m.handOverTo, { name })}
            question={format(m.handOverConfirm, { name })}
            confirm={m.handOver}
            cancel={m.cancel}
            onConfirm={() => act(() => handOver(workspaceId, member.id))}
          />
        )}
        {controls.remove && (
          <ConfirmMenu
            trigger={
              <button
                type="button"
                disabled={busy}
                aria-label={format(m.removeFor, { name })}
                className={cn(action, 'text-danger hover:text-danger')}
              >
                {m.remove}
              </button>
            }
            label={format(m.removeFor, { name })}
            question={format(m.removeConfirm, { name })}
            confirm={m.remove}
            cancel={m.cancel}
            danger
            onConfirm={() => act(() => remove(workspaceId, member.id))}
          />
        )}
      </span>
    </li>
  )
}

/** The member's role as a button that opens the roles a member can be given, theirs ticked. */
function RoleMenu({
  role,
  name,
  busy,
  onPick,
}: {
  role: MemberRole
  name: string
  busy: boolean
  onPick: (role: InviteRole) => void
}) {
  const s = useMessages().settings
  const [open, setOpen] = useState(false)
  const label = format(s.member.roleOf, { name })
  return (
    <Menu
      trigger={
        <button
          type="button"
          disabled={busy}
          aria-label={`${label}: ${s.roles[role]}`}
          className={cn(
            buttonStyles({ variant: 'ghost', size: 'md' }),
            'h-8 gap-1 px-2.5 text-label font-medium text-muted hover:text-text',
          )}
        >
          {s.roles[role]}
          <CaretDownIcon size={12} weight="bold" aria-hidden />
        </button>
      }
      open={open}
      onOpenChange={setOpen}
      label={label}
      place={{ side: 'bottom', align: 'end', sideOffset: 6, collisionPadding: 12 }}
      className="w-48"
    >
      <MenuRadios
        value={role}
        label={label}
        onValueChange={(picked) => {
          const next = INVITE_ROLES.find((each) => each === picked)
          if (next && next !== role) onPick(next)
        }}
      >
        {INVITE_ROLES.map((each) => (
          <MenuRadio key={each} value={each} label={s.roles[each]} data-role={each}>
            {s.roles[each]}
            <CheckIcon size={14} aria-hidden className="invisible shrink-0 group-aria-checked:visible" />
          </MenuRadio>
        ))}
      </MenuRadios>
    </Menu>
  )
}
