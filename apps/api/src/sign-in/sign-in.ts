// Sign-in with WorkOS AuthKit (#58). The API alone holds the WorkOS key: it gives the web app the
// sign-in link, swaps the code WorkOS sends back for the person, and makes their session. During early
// access only those it allows get in. Each sign-in accepts the person's invites that their provider says
// they accepted, a workspace's and a Dazbee invite alike; one that leaves them in no workspace makes a
// workspace (one WorkOS organization) with the person as its Owner (ADR-0011).
import { WorkOS } from '@workos-inc/node'

import { type Db, memberships, newId, type Tx, users, workspaces } from '@dazbee/db'
import type { SignedIn } from '@dazbee/schema'

import type { Admins } from '../admin/admins.ts'
import { acceptDazbeeInvite, pendingDazbeeInvites, type WaitingDazbeeInvite } from '../admin/dazbee-invites.ts'
import { acceptInvite, type WaitingInvite, waitingInvites } from '../members/invites.ts'
import {
  dazbeeInvitesProvider,
  type InvitesProvider,
  invitesProviderFor,
  type InvitesProviders,
  type ProviderInvite,
} from '../members/invites-provider.ts'
import { workspaceToOpen } from '../workspace/workspace.ts'
import { type AllowList, type EarlyAccess, earlyAccessRefusal, EarlyAccessRefused } from './early-access.ts'
import { signSessionToken } from './session.ts'

/** A person WorkOS signed in. */
export interface SignedInPerson {
  /** `emailVerified`: whether WorkOS checked the person owns the email. */
  user: { id: string; email: string; name: string; emailVerified: boolean }
  /** Their WorkOS session, ended again when they sign out. */
  sessionId: string | null
}

/** What the API needs from WorkOS; tests give it a stand-in that never calls out. */
export interface SignInProvider {
  /**
   * The sign-in page's link, carrying an invite's token when the person came from one, and sending them back
   * to `redirectUri` when given, else to the web app's /callback.
   */
  signInUrl(state: string, invitationToken?: string, redirectUri?: string): string
  /** The person a code from the sign-in page is for; throws when the code is not good. */
  authenticate(code: string): Promise<SignedInPerson>
  /** A new organization for a workspace, returning its WorkOS id. */
  createOrganization(name: string, workspaceId: string): Promise<string>
  addMember(organizationId: string, workosUserId: string): Promise<void>
  /** Where to end a WorkOS session; WorkOS then sends the person to the web app's /login. */
  signOutUrl(sessionId: string): string
  /** Ends a WorkOS session from here, so the next sign-in asks who the person is again. */
  endSession(sessionId: string): Promise<void>
}

/** What accepting a person's invites did: the workspace to open, and whether an invite went unread. */
export interface Accepting {
  open: string | null
  unread: boolean
}

/** The person's pending invites as their providers hold them, read before anything is written. */
export interface HeldInvites {
  /** The pending workspace invites their provider says this person accepted, oldest first. */
  accepted: WaitingInvite[]
  /** The pending Dazbee invites their provider says this person accepted. */
  dazbee: WaitingDazbeeInvite[]
  /** Whether the person's email has an invite its provider still holds as pending. */
  waiting: boolean
  /** Whether an invite's provider couldn't be read now, which leaves that invite for a later sign-in. */
  unread: boolean
}

/**
 * Sign-in with WorkOS, when it is set up: the provider, the secret session tokens are signed with, and
 * early access's allow-list and admins (with neither, anyone may sign up).
 */
export interface SignInSettings {
  provider: SignInProvider
  secret: string
  allowed?: AllowList
  admins?: Admins
}

export interface WorkosSettings {
  apiKey: string
  clientId: string
  /** The web app's /callback, as registered with WorkOS. */
  redirectUri: string
}

/** A sign-in that couldn't finish for now, answered 503 with its message so the person tries again. */
export class SignInUnfinished extends Error {}

/** The workspace a first sign-in makes is called after its person until onboarding names it. */
const firstWorkspaceName = (user: SignedInPerson['user']) =>
  (user.name || user.email.split('@')[0] || user.email).slice(0, 120)

/** WorkOS settings from the environment, or null when sign-in is not set up. */
export function workosSettings(env: NodeJS.ProcessEnv = process.env): WorkosSettings | null {
  const { WORKOS_API_KEY: apiKey, WORKOS_CLIENT_ID: clientId, WORKOS_REDIRECT_URI: redirectUri } = env
  if (!apiKey && !clientId && !redirectUri) return null
  if (!apiKey || !clientId || !redirectUri)
    throw new Error('Set WORKOS_API_KEY, WORKOS_CLIENT_ID and WORKOS_REDIRECT_URI together')
  return { apiKey, clientId, redirectUri }
}

/** The `sid` claim of a WorkOS access token, which we got from WorkOS itself over TLS. */
export function accessTokenSessionId(accessToken: string): string | null {
  try {
    const claims = JSON.parse(Buffer.from(accessToken.split('.')[1] ?? '', 'base64url').toString('utf8')) as {
      sid?: unknown
    }
    return typeof claims.sid === 'string' ? claims.sid : null
  } catch {
    return null
  }
}

export function workosProvider({ apiKey, clientId, redirectUri }: WorkosSettings): SignInProvider {
  const workos = new WorkOS(apiKey, { clientId })
  return {
    signInUrl: (state, invitationToken, site = redirectUri) =>
      workos.userManagement.getAuthorizationUrl({
        provider: 'authkit',
        clientId,
        redirectUri: site,
        state,
        ...(invitationToken ? { invitationToken } : {}),
      }),
    async authenticate(code) {
      const { user, accessToken } = await workos.userManagement.authenticateWithCode({ clientId, code })
      const name = [user.firstName, user.lastName].filter(Boolean).join(' ')
      return {
        user: { id: user.id, email: user.email, name, emailVerified: user.emailVerified },
        sessionId: accessTokenSessionId(accessToken),
      }
    },
    async createOrganization(name, workspaceId) {
      return (await workos.organizations.createOrganization({ name, externalId: workspaceId })).id
    },
    async addMember(organizationId, userId) {
      // Roles are ours (memberships.role); WorkOS only needs to know the person belongs.
      await workos.userManagement.createOrganizationMembership({ organizationId, userId })
    },
    // WorkOS sends the person back to the web app's /login, on the same site as its /callback.
    signOutUrl: (sessionId) =>
      workos.userManagement.getLogoutUrl({ sessionId, returnTo: new URL('/login', redirectUri).href }),
    async endSession(sessionId) {
      await workos.userManagement.revokeSession({ sessionId })
    },
  }
}

/**
 * Signs in a person WorkOS vouched for: lets them in or refuses them during early access, records them,
 * accepts their invites, picks the workspace to open (an invite's just accepted, else the one they used
 * last, else the one they joined first) or makes their first, and makes their session, which names no
 * workspace. A refused person throws `EarlyAccessRefused` with nothing recorded, and during early access
 * only a verified email on the list gets a workspace of its own.
 */
export async function completeSignIn(
  db: Db,
  { provider, secret, allowed = null, admins = new Set() }: SignInSettings,
  invites: InvitesProviders,
  person: SignedInPerson,
): Promise<SignedIn> {
  const access: EarlyAccess = { allowed, admins }
  const held = await readInvites(db, invites, { email: person.user.email, workosUserId: person.user.id })
  const refusal = await earlyAccessRefusal(db, access, person, {
    accepting: held.accepted.length > 0 || held.dazbee.length > 0,
    joining: held.dazbee.length > 0,
    waiting: held.waiting,
  })
  // An unread invite may be one they accepted: refusing them would be wrong.
  if (refusal && held.unread) throw new SignInUnfinished("Sign-in couldn't finish; try again")
  if (refusal) throw new EarlyAccessRefused(refusal)

  const { userId, found } = await db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({ id: newId(), workosUserId: person.user.id, email: person.user.email, name: person.user.name })
      .onConflictDoUpdate({ target: users.workosUserId, set: { email: person.user.email, name: person.user.name } })
      .returning({ id: users.id })
    if (!user) throw new Error('The user was not recorded')
    let joined = false
    for (const invite of held.dazbee) joined = (await acceptDazbeeInvite(tx, invite.id)) || joined
    const open = (await acceptHeld(tx, held, user.id)) ?? (await workspaceToOpen(tx, user.id))
    // An unread invite may be one they accepted: making them a workspace of their own would be wrong.
    if (!open && held.unread) throw new SignInUnfinished("Sign-in couldn't finish; try again")
    // A person about to get a workspace of their own is asked again, with no workspace invite or membership
    // left to let them in, and a Dazbee invite only if it was accepted here; a refusal undoes their record.
    if (!open) {
      const again = await earlyAccessRefusal(tx, access, person, {
        accepting: joined,
        joining: joined,
        waiting: held.waiting,
      })
      if (again) throw new EarlyAccessRefused(again)
    }
    return { userId: user.id, found: open }
  })

  let open = found
  if (!open) {
    // WorkOS first, so a failure there leaves nothing half made here.
    const id = newId()
    const name = firstWorkspaceName(person.user)
    const organizationId = await provider.createOrganization(name, id)
    await provider.addMember(organizationId, person.user.id)
    await db.transaction(async (tx) => {
      await tx.insert(workspaces).values({ id, name, workosOrganizationId: organizationId })
      await tx.insert(memberships).values({ workspaceId: id, userId, role: 'owner' })
    })
    open = id
  }

  const { token, expiresAt } = signSessionToken(secret, { userId, workosSessionId: person.sessionId })
  return { token, expiresAt, open }
}

/**
 * Accepts each pending invite of the person's email that its provider says this person accepted, making
 * their membership with its role. Answers the workspace of the newest one accepted (null when none was),
 * and whether an invite's provider couldn't be read now, which leaves that invite for a later sign-in.
 * Which organization WorkOS signed the person in to plays no part.
 */
export async function acceptInvites(
  db: Db | Tx,
  invites: InvitesProviders,
  person: { id: string; email: string; workosUserId: string },
): Promise<Accepting> {
  const held = await readInvites(db, invites, person)
  return { open: await acceptHeld(db, held, person.id), unread: held.unread }
}

/**
 * The pending invites of the person's email, a workspace's and Dazbee invites, each read from its provider;
 * writes nothing.
 */
async function readInvites(
  db: Db | Tx,
  invites: InvitesProviders,
  person: { email: string; workosUserId: string },
): Promise<HeldInvites> {
  const [waiting, dazbee] = await Promise.all([
    waitingInvites(db, person.email),
    pendingDazbeeInvites(db, person.email),
  ])
  const dazbeeProvider = dazbeeInvitesProvider(invites)
  const read = await Promise.all([
    ...waiting.map((invite) => readInvite(invitesProviderFor(invites, invite.organizationId), invite.providerInviteId)),
    ...dazbee.map((invite) => readInvite(dazbeeProvider, invite.providerInviteId)),
  ])
  const acceptedHere = (i: number) => {
    const held = read[i]
    return held?.state === 'accepted' && held.acceptedUserId === person.workosUserId
  }
  return {
    accepted: waiting.filter((_, i) => acceptedHere(i)),
    dazbee: dazbee.filter((_, i) => acceptedHere(waiting.length + i)),
    waiting: read.some((held) => held?.state === 'pending'),
    unread: read.includes(null),
  }
}

/** Accepts the invites the person accepted, as user `userId`: the workspace of the newest one accepted, or null. */
async function acceptHeld(db: Db | Tx, held: HeldInvites, userId: string): Promise<string | null> {
  let open: string | null = null
  for (const invite of held.accepted) {
    if (await acceptInvite(db, invite.id, userId)) open = invite.workspaceId
  }
  return open
}

/** The invite as its provider holds it; null when the provider can't say now, undefined when there is none here. */
async function readInvite(provider: InvitesProvider | null, id: string): Promise<ProviderInvite | null | undefined> {
  if (!provider) return undefined
  try {
    return await provider.read(id)
  } catch (e) {
    console.error(e)
    return null
  }
}
