// Early access: while the allow-list is set, sign-in lets in only a person who already has a membership,
// one whose sign-in accepts an invite, and one whose verified email is on the list. Asking only reads, so a
// refused person leaves no row behind.
import { eq } from 'drizzle-orm'

import { type Db, memberships, type Tx, users } from '@dazbee/db'
import type { SignInRefusal } from '@dazbee/schema'

import type { SignedInPerson } from './sign-in.ts'

/** The emails allowed to sign up, in lower case; null lets anyone sign up. */
export type AllowList = ReadonlySet<string> | null

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
 * Why early access refuses the person, or null when it lets them in: always with no allow-list, else when
 * their sign-in accepts an invite, their verified email is on the list, or they already have a membership.
 * A refused person with a pending invite of their email is told to open it.
 */
export async function earlyAccessRefusal(
  db: Db | Tx,
  allowed: AllowList,
  person: SignedInPerson,
  invites: { accepting: boolean; waiting: boolean },
): Promise<SignInRefusal | null> {
  if (!allowed || invites.accepting) return null
  if (person.user.emailVerified && allowed.has(person.user.email.toLowerCase())) return null
  if (await hasMembership(db, person.user.id)) return null
  return invites.waiting ? 'open-invite' : 'early-access'
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
