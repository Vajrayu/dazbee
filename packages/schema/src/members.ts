// A workspace's members and its invites: who is in the workspace, the invites still waiting, what
// inviting someone asks for, and what changing a member's role asks for.
import { z } from 'zod'

import { MemberRole, RecordId } from './api.ts'

/** A member of the workspace as its members list shows them: the person's id, name, email and role. */
export const WorkspaceMember = z.object({
  id: RecordId,
  /** Empty for a person who gave no name. */
  name: z.string(),
  email: z.string(),
  role: MemberRole,
})
export type WorkspaceMember = z.infer<typeof WorkspaceMember>

/** The roles an invite gives: every role but Owner, which is only handed over. */
export const INVITE_ROLES = ['admin', 'editor', 'reviewer'] as const

export const InviteRole = z.enum(INVITE_ROLES, { error: 'An invite makes an Admin, Editor or Reviewer' })
export type InviteRole = z.infer<typeof InviteRole>

/** A pending invite: to whom, with which role, until when, and the link that accepts it. */
export const Invite = z.object({
  id: RecordId,
  email: z.string(),
  role: InviteRole,
  expiresAt: z.iso.datetime(),
  link: z.url(),
})
export type Invite = z.infer<typeof Invite>

/** Invites an email to the workspace with a role; the email is kept lower-cased. */
export const CreateInvite = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  role: InviteRole,
})
export type CreateInvite = z.infer<typeof CreateInvite>

/** Changes a member's role, to any role but Owner, which is only handed over. */
export const UpdateMember = z.object({
  role: z.enum(INVITE_ROLES, { error: 'A member can be made an Admin, Editor or Reviewer' }),
})
export type UpdateMember = z.infer<typeof UpdateMember>

/** Accepts a development invite: the id its link names. */
export const AcceptDevInvite = z.object({ invite: RecordId })
export type AcceptDevInvite = z.infer<typeof AcceptDevInvite>
