// Early access's admin page and waiting list: Dazbee invites as an admin lists them, inviting an email, the
// people who joined through one or whose access was removed, and a request to join sent from /login.
import { z } from 'zod'

import { RecordId } from './api.ts'

/** An email as a person types it, kept lower-cased. */
const Email = z.string().trim().toLowerCase().max(254).pipe(z.email())

/** A pending Dazbee invite: to whom, until when, and the link that accepts it. */
export const DazbeeInvite = z.object({
  id: RecordId,
  email: z.string(),
  expiresAt: z.iso.datetime(),
  link: z.url(),
})
export type DazbeeInvite = z.infer<typeof DazbeeInvite>

/**
 * A person who joined through a Dazbee invite, or whose access was then removed: the invite's id, their
 * email, the name they signed up with (empty when they gave none), and when they joined or were removed.
 */
export const InvitedPerson = z.object({
  id: RecordId,
  email: z.string(),
  name: z.string(),
  at: z.iso.datetime(),
})
export type InvitedPerson = z.infer<typeof InvitedPerson>

/** Every Dazbee invite as the admin page lists them: pending oldest first, joined and removed newest first. */
export const DazbeeInvites = z.object({
  pending: DazbeeInvite.array(),
  joined: InvitedPerson.array(),
  removed: InvitedPerson.array(),
})
export type DazbeeInvites = z.infer<typeof DazbeeInvites>

/** Invites an email to Dazbee. */
export const CreateDazbeeInvite = z.object({ email: Email })
export type CreateDazbeeInvite = z.infer<typeof CreateDazbeeInvite>

/**
 * A request to join, sent from /login: email, name, company, what they will make, which may be empty, and
 * the token of the form's Turnstile check, when the form has one.
 */
export const RequestAccess = z.object({
  email: Email,
  name: z.string().trim().min(1).max(120),
  company: z.string().trim().min(1).max(120),
  note: z.string().trim().max(1000).default(''),
  turnstileToken: z.string().min(1).max(4096).optional(),
})
export type RequestAccess = z.infer<typeof RequestAccess>

/** A request on the waiting list, not yet invited. */
export const AccessRequest = z.object({
  id: RecordId,
  email: z.string(),
  name: z.string(),
  company: z.string(),
  note: z.string(),
  requestedAt: z.iso.datetime(),
})
export type AccessRequest = z.infer<typeof AccessRequest>
