// Sign-in with WorkOS AuthKit (#58). The API alone holds the WorkOS key: it gives the web app the
// sign-in link, swaps the code WorkOS sends back for the person, and makes their session. Each sign-in
// accepts the person's invites that their provider says they accepted; one that leaves them in no
// workspace makes a workspace (one WorkOS organization) with the person as its Owner (ADR-0011).
import { WorkOS } from '@workos-inc/node'

import { type Db, memberships, newId, type Tx, users, workspaces } from '@dazbee/db'
import type { SignedIn } from '@dazbee/schema'

import { acceptInvite, waitingInvites } from '../members/invites.ts'
import {
  type InvitesProvider,
  invitesProviderFor,
  type InvitesProviders,
  type ProviderInvite,
} from '../members/invites-provider.ts'
import { workspaceToOpen } from '../workspace/workspace.ts'
import { signSessionToken } from './session.ts'

/** A person WorkOS signed in. */
export interface SignedInPerson {
  user: { id: string; email: string; name: string }
  /** Their WorkOS session, ended again when they sign out. */
  sessionId: string | null
}

/** What the API needs from WorkOS; tests give it a stand-in that never calls out. */
export interface SignInProvider {
  /** The sign-in page's link, carrying an invite's token when the person came from one. */
  signInUrl(state: string, invitationToken?: string): string
  /** The person a code from the sign-in page is for; throws when the code is not good. */
  authenticate(code: string): Promise<SignedInPerson>
  /** A new organization for a workspace, returning its WorkOS id. */
  createOrganization(name: string, workspaceId: string): Promise<string>
  addMember(organizationId: string, workosUserId: string): Promise<void>
  /** Where to end a WorkOS session; WorkOS then sends the person to the web app's /login. */
  signOutUrl(sessionId: string): string
}

/** What accepting a person's invites did: the workspace to open, and whether an invite went unread. */
export interface Accepting {
  open: string | null
  unread: boolean
}

/** Sign-in with WorkOS, when it is set up: the provider, and the secret session tokens are signed with. */
export interface SignInSettings {
  provider: SignInProvider
  secret: string
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
    signInUrl: (state, invitationToken) =>
      workos.userManagement.getAuthorizationUrl({
        provider: 'authkit',
        clientId,
        redirectUri,
        state,
        ...(invitationToken ? { invitationToken } : {}),
      }),
    async authenticate(code) {
      const { user, accessToken } = await workos.userManagement.authenticateWithCode({ clientId, code })
      const name = [user.firstName, user.lastName].filter(Boolean).join(' ')
      return { user: { id: user.id, email: user.email, name }, sessionId: accessTokenSessionId(accessToken) }
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
  }
}

/**
 * Signs in a person WorkOS vouched for: records them, accepts their invites, picks the workspace to open
 * (an invite's just accepted, else the one they used last, else the one they joined first) or makes their
 * first, and makes their session, which names no workspace.
 */
export async function completeSignIn(
  db: Db,
  { provider, secret }: SignInSettings,
  invites: InvitesProviders,
  person: SignedInPerson,
): Promise<SignedIn> {
  const [user] = await db
    .insert(users)
    .values({ id: newId(), workosUserId: person.user.id, email: person.user.email, name: person.user.name })
    .onConflictDoUpdate({ target: users.workosUserId, set: { email: person.user.email, name: person.user.name } })
    .returning({ id: users.id })
  if (!user) throw new Error('The user was not recorded')

  const accepting = await acceptInvites(db, invites, {
    id: user.id,
    email: person.user.email,
    workosUserId: person.user.id,
  })
  let open = accepting.open ?? (await workspaceToOpen(db, user.id))
  // An unread invite may be one they accepted: making them a workspace of their own would be wrong.
  if (!open && accepting.unread) throw new SignInUnfinished("Sign-in couldn't finish; try again")
  if (!open) {
    // WorkOS first, so a failure there leaves nothing half made here.
    const id = newId()
    const name = firstWorkspaceName(person.user)
    const organizationId = await provider.createOrganization(name, id)
    await provider.addMember(organizationId, person.user.id)
    await db.transaction(async (tx) => {
      await tx.insert(workspaces).values({ id, name, workosOrganizationId: organizationId })
      await tx.insert(memberships).values({ workspaceId: id, userId: user.id, role: 'owner' })
    })
    open = id
  }

  const { token, expiresAt } = signSessionToken(secret, { userId: user.id, workosSessionId: person.sessionId })
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
  const waiting = await waitingInvites(db, person.email)
  const read = await Promise.all(
    waiting.map((invite) => readInvite(invitesProviderFor(invites, invite.organizationId), invite.providerInviteId)),
  )
  let open: string | null = null
  for (const [i, invite] of waiting.entries()) {
    const held = read[i]
    if (held?.state !== 'accepted' || held.acceptedUserId !== person.workosUserId) continue
    if (await acceptInvite(db, invite.id, person.id)) open = invite.workspaceId
  }
  return { open, unread: read.includes(null) }
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
