// A workspace's members and its invites: who is in the workspace and which brands they may see, the
// invites still waiting, what inviting someone asks for, and what changing a member's role or brands
// asks for.
import { z } from 'zod'

import { MemberRole, RecordId } from './api.ts'

/** The brands a member may see, as a list of the workspace's brands, or null for every brand. */
export const MemberBrands = z.array(RecordId).nullable()
export type MemberBrands = z.infer<typeof MemberBrands>

/**
 * A member of the workspace as its members list shows them: the person's id, name, email and role, and
 * the brands they may see. A viewer limited to some brands is shown only those of their own among them.
 */
export const WorkspaceMember = z.object({
  id: RecordId,
  /** Empty for a person who gave no name. */
  name: z.string(),
  email: z.string(),
  role: MemberRole,
  brandIds: MemberBrands,
})
export type WorkspaceMember = z.infer<typeof WorkspaceMember>

/** The roles an invite gives: every role but Owner, which is only handed over. */
export const INVITE_ROLES = ['admin', 'editor', 'reviewer'] as const

export const InviteRole = z.enum(INVITE_ROLES, { error: 'An invite makes an Admin, Editor or Reviewer' })
export type InviteRole = z.infer<typeof InviteRole>

/** A pending invite: to whom, with which role and brands, until when, and the link that accepts it. */
export const Invite = z.object({
  id: RecordId,
  email: z.string(),
  role: InviteRole,
  brandIds: MemberBrands,
  expiresAt: z.iso.datetime(),
  link: z.url(),
})
export type Invite = z.infer<typeof Invite>

/** A limit a route is given: at least one brand, each kept once, or null for every brand. */
export const BrandLimit = z
  .array(RecordId)
  .min(1, 'Name at least one brand, or null for every brand')
  .max(1000)
  .transform((ids) => [...new Set(ids)])
  .nullable()
export type BrandLimit = z.infer<typeof BrandLimit>

/**
 * Invites an email to the workspace with a role and, for an Editor or Reviewer, the brands they may see
 * (every brand when left out); the email is kept lower-cased.
 */
export const CreateInvite = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  role: InviteRole,
  brandIds: BrandLimit.default(null),
})
export type CreateInvite = z.infer<typeof CreateInvite>

/**
 * Changes a member's role, to any role but Owner, which is only handed over, or the brands they may see,
 * or both. A member made an Admin sees every brand.
 */
export const UpdateMember = z
  .object({
    role: z.enum(INVITE_ROLES, { error: 'A member can be made an Admin, Editor or Reviewer' }).optional(),
    brandIds: BrandLimit.optional(),
  })
  .refine((update) => update.role !== undefined || update.brandIds !== undefined, 'Give a role, brands or both')
export type UpdateMember = z.infer<typeof UpdateMember>

/** Accepts a development invite: the id its link names. */
export const AcceptDevInvite = z.object({ invite: RecordId })
export type AcceptDevInvite = z.infer<typeof AcceptDevInvite>
