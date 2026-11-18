'use client'

// This workspace's Members: each member's initials, name, email and role, and an Editor's or Reviewer's
// brands, from Owner down, in rows like the Pages card's, lit by a tint under the pointer and with no
// outlines. An Owner or Admin sees, on every other member's row but the Owner's, the role as a menu that
// changes it, an Editor's or Reviewer's brands as a menu that changes them, and Remove; the Owner also sees
// Hand over Owner on an Admin's row. Remove and Hand over each ask once, in a small menu, and so does making
// a member limited to some brands an Admin, in the role menu, since they then see every brand. Why the API
// refused a change shows under the heading, so it stays when the member has left the list.
import { useState, useTransition } from 'react'

import {
  type BrandSummary,
  INVITE_ROLES,
  type InviteRole,
  type MemberBrands,
  type MemberRole,
  type WorkspaceMember,
} from '@dazbee/schema'

import { changeBrands, changeRole, handOver, remove } from '@/app/w/[workspaceId]/(workspace)/settings/actions.ts'
import { buttonStyles } from '@/components/ui/button.tsx'
import { CaretDownIcon, CheckIcon } from '@/components/ui/icons.tsx'
import { Menu, MenuRadio, MenuRadios } from '@/components/ui/menu.tsx'
import { cn } from '@/lib/cn.ts'
import { useMessages } from '@/lib/i18n/client.tsx'
import { format } from '@/lib/i18n/index.ts'
import { initialsOf } from '@/lib/initials.ts'
import { asksBeforeRole, canLimit, type RowControls, rowControls } from '@/lib/settings-rights.ts'

import { brandsLabel, BrandsMenu } from './brands-choice.tsx'
import { ConfirmMenu, ConfirmRows } from './confirm-menu.tsx'
import { Note } from './note.tsx'

/** A change a row makes to its member, which gives why the API refused it, or null. */
type MemberChange = () => Promise<string | null>

/** The words a row's member goes by: their name, else their email. */
const nameOf = (member: WorkspaceMember) => member.name || member.email

export function MembersPanel({
  workspaceId,
  members,
  brands,
  viewerId,
  viewerRole,
  viewerLimited,
}: {
  workspaceId: string
  members: WorkspaceMember[]
  /** The workspace's brands the viewer sees, which name the members'. */
  brands: BrandSummary[]
  /** The person looking, whose own row shows no controls. */
  viewerId: string
  viewerRole: MemberRole
  /**
   * Whether the viewer is limited to some brands, and so sees of each member's brands only their own: a
   * member with none of those shows no brands rather than "No brands".
   */
  viewerLimited: boolean
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
            brands={brands}
            viewerLimited={viewerLimited}
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
  brands,
  viewerLimited,
  controls,
  onAct,
  onRefused,
}: {
  workspaceId: string
  member: WorkspaceMember
  brands: BrandSummary[]
  viewerLimited: boolean
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
            brandIds={member.brandIds}
            name={name}
            busy={busy}
            onPick={(role) => act(() => changeRole(workspaceId, member.id, role))}
          />
        ) : (
          <span className="px-2.5 text-label font-medium text-muted">{s.roles[member.role]}</span>
        )}
        {controls.brands ? (
          <BrandsMenu
            brands={brands}
            brandIds={member.brandIds}
            name={name}
            busy={busy}
            onSave={(brandIds) => act(() => changeBrands(workspaceId, member.id, brandIds))}
          />
        ) : (
          canLimit(member.role) &&
          !(viewerLimited && member.brandIds?.length === 0) && (
            <span data-testid="member-brands" className="max-w-56 truncate px-2.5 text-label font-medium text-muted">
              {brandsLabel(member.brandIds, brands, s.brands)}
            </span>
          )
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

/**
 * The member's role as a button that opens the roles a member can be given, theirs ticked. A role that
 * asks first (`asksBeforeRole`) keeps the menu open on the question, with the change and Cancel.
 */
function RoleMenu({
  role,
  brandIds,
  name,
  busy,
  onPick,
}: {
  role: MemberRole
  /** The member's brands, which decide whether a role asks first. */
  brandIds: MemberBrands
  name: string
  busy: boolean
  onPick: (role: InviteRole) => void
}) {
  const s = useMessages().settings
  const m = s.member
  const [open, setOpen] = useState(false)
  // The role picked that asks first, while the menu asks.
  const [asking, setAsking] = useState<InviteRole | null>(null)
  const label = format(m.roleOf, { name })
  /** Whether picking `each` asks first, keeping the menu open on the question. */
  const asks = (each: InviteRole) => each !== role && asksBeforeRole(brandIds, each)
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
      onOpenChange={(opening) => {
        // Each opening starts at the roles, not the question.
        setAsking(null)
        setOpen(opening)
      }}
      label={label}
      place={{ side: 'bottom', align: 'end', sideOffset: 6, collisionPadding: 12 }}
      className={asking ? 'w-72' : 'w-48'}
    >
      {asking ? (
        <ConfirmRows
          question={format(m.makeAdminConfirm, { name })}
          confirm={m.makeAdmin}
          cancel={m.cancel}
          focus
          onConfirm={() => onPick(asking)}
        />
      ) : (
        <MenuRadios
          value={role}
          label={label}
          onValueChange={(picked) => {
            const next = INVITE_ROLES.find((each) => each === picked)
            if (!next || next === role) return
            if (asks(next)) setAsking(next)
            else onPick(next)
          }}
        >
          {INVITE_ROLES.map((each) => (
            <MenuRadio key={each} value={each} label={s.roles[each]} stayOpen={asks(each)} data-role={each}>
              {s.roles[each]}
              <CheckIcon size={14} aria-hidden className="invisible shrink-0 group-aria-checked:visible" />
            </MenuRadio>
          ))}
        </MenuRadios>
      )}
    </Menu>
  )
}
