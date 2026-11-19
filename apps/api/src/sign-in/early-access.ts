// Early access: while the allow-list or the admins are set, sign-in lets in only an admin, a person who
// already has a membership, one whose sign-in accepts an invite (a workspace's or a Dazbee invite), and one
// whose verified email is on the list. A person whose access an admin removed is refused at sign-in, early
// access or not, and their session's requests are answered 401. Asking only reads, so a refused person leaves
// no row behind, and their WorkOS session is ended so they can sign in as someone else.
import { eq } from 'drizzle-orm'

import { type Db, memberships, type Tx, users } from '@dazbee/db'
import type { SignInRefusal, SignInRefused } from '@dazbee/schema'

import type { Admins } from '../admin/admins.ts'
import { isRemoved, isRemovedUser } from '../admin/dazbee-invites.ts'
import { error } from '../http.ts'
import type { SignedInPerson, SignInProvider } from './sign-in.ts'

/** The emails allowed to sign up, in lower case; null lets anyone sign up. */
export type AllowList = ReadonlySet<string> | null

/** Who early access lets in by email: the allow-list, and the admins, who are always let in. */
export interface EarlyAccess {
  allowed: AllowList
  admins: Admins
}

/** What each refusal tells the person. */
const REFUSALS: Record<SignInRefusal, string> = {
  'early-access': 'Dazbee is in early access',
  'open-invite': 'Open the invite in your email to join',
}

/** A sign-in early access refuses, answered 403 with its reason. */
export class EarlyAccessRefused extends Error {
  readonly reason: SignInRefusal
  constructor(reason: SignInRefusal) {
    super(REFUSALS[reason])
    this.reason = reason
  }
}

/** The allow-list from `ALLOWED_EMAILS`, a comma-separated list of emails; null when it names none. */
export function allowList(env: NodeJS.ProcessEnv = process.env): AllowList {
  const emails = (env.ALLOWED_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
  return emails.length > 0 ? new Set(emails) : null
}

/**
 * Why early access refuses the person, or null when it lets them in. A verified admin is always let in, and
 * a person whose access was removed always refused. Otherwise, with neither an allow-list nor admins, anyone
 * is let in; else a person whose sign-in accepts an invite, whose verified email is on the list, or who
 * already has a membership. A refused person whose verified email has an invite still pending with its
 * provider is told to open it.
 */
export async function earlyAccessRefusal(
  db: Db | Tx,
  { allowed, admins }: EarlyAccess,
  person: SignedInPerson,
  invites: { accepting: boolean; waiting: boolean },
): Promise<SignInRefusal | null> {
  const email = person.user.email.toLowerCase()
  const verified = person.user.emailVerified
  if (verified && admins.has(email)) return null
  if (await isRemoved(db, email)) return 'early-access'
  if ((!allowed && admins.size === 0) || invites.accepting) return null
  if (verified && allowed?.has(email)) return null
  if (await hasMembership(db, person.user.id)) return null
  return invites.waiting && verified ? 'open-invite' : 'early-access'
}

/**
 * The refusal of a session whose person's access was removed, for `requireSession`, so an open session ends
 * at its next request; null for anyone else.
 */
export function removedRefusal(db: Db, admins: Admins): (userId: string) => Promise<SignInRefused | null> {
  const refused = new EarlyAccessRefused('early-access')
  return async (userId) =>
    (await isRemovedUser(db, userId, admins)) ? { ...error(refused.message), reason: refused.reason } : null
}

/** Ends a refused person's WorkOS session, so their next sign-in can be with another account. */
export async function endRefusedSession(provider: SignInProvider, person: SignedInPerson): Promise<void> {
  if (!person.sessionId) return
  try {
    await provider.endSession(person.sessionId)
  } catch (e) {
    console.error(e)
  }
}

/** Whether the WorkOS user is already a member of some workspace. */
async function hasMembership(db: Db | Tx, workosUserId: string): Promise<boolean> {
  const [member] = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(users.workosUserId, workosUserId))
    .limit(1)
  return Boolean(member)
}
