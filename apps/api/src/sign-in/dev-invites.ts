// The development stand-in for invites, for a workspace with no WorkOS organization, such as the
// development workspace; given only when the development session is on. It keeps its invites in our table
// alone, and its link is the web app's /dev/accept, whose accept route signs in the person with the
// invite's email, made up on first use, and accepts the invite as WorkOS would.
import { and, eq, isNull } from 'drizzle-orm'
import { Hono } from 'hono'

import { type Db, invites, newId, users, workspaces } from '@dazbee/db'
import { AcceptDevInvite, type SignedIn } from '@dazbee/schema'

import { body, type Env, error } from '../http.ts'
import { inviteExpiry, type InvitesProvider, type ProviderInvite } from '../members/invites-provider.ts'
import { signSessionToken } from './session.ts'
import { acceptInvites } from './sign-in.ts'

/** The stand-in: an invites provider whose invites are accepted through its accept route. */
export interface DevInvites extends InvitesProvider {
  /** Marks the invite accepted by the person, as their accepting it with WorkOS would. */
  accept(id: string, workosUserId: string): void
  /** Drops what `accept` marked, once our table holds the invite as accepted, or accepting failed. */
  forget(id: string): void
}

/** The stand-in, with the secret its accept route signs sessions with. */
export interface DevInvitesSettings {
  provider: DevInvites
  secret: string
}

/** Accepting through the stand-in made no membership; the transaction that made its person rolls back. */
class NotAccepted extends Error {}

/** The stand-in, whose links open the web app at `webUrl`. */
export function devInvites(db: Db, webUrl: string): DevInvites {
  // Who accepted each invite through the accept route, by its id, until `forget`.
  const acceptedBy = new Map<string, string>()

  const linkOf = (id: string) => new URL(`/dev/accept?invite=${id}`, webUrl).href

  async function read(id: string): Promise<ProviderInvite> {
    const [row] = await db
      .select({ expiresAt: invites.expiresAt, acceptedAt: invites.acceptedAt, revokedAt: invites.revokedAt })
      .from(invites)
      .where(eq(invites.providerInviteId, id))
    if (!row) throw new Error(`No development invite ${id}`)
    const acceptedUserId = acceptedBy.get(id) ?? null
    const state = row.revokedAt
      ? 'revoked'
      : row.acceptedAt || acceptedUserId
        ? 'accepted'
        : row.expiresAt.getTime() <= Date.now()
          ? 'expired'
          : 'pending'
    return { id, state, link: linkOf(id), expiresAt: row.expiresAt, acceptedUserId }
  }
  function invite(): Promise<ProviderInvite> {
    const id = newId()
    return Promise.resolve({ id, state: 'pending', link: linkOf(id), expiresAt: inviteExpiry(), acceptedUserId: null })
  }
  async function resend(id: string): Promise<ProviderInvite> {
    return { ...(await read(id)), expiresAt: inviteExpiry() }
  }
  async function revoke(id: string): Promise<ProviderInvite> {
    const held = await read(id)
    return held.state === 'pending' ? { ...held, state: 'revoked' } : held
  }
  function removeMember(): Promise<void> {
    return Promise.resolve()
  }
  function accept(id: string, workosUserId: string) {
    acceptedBy.set(id, workosUserId)
  }
  function forget(id: string) {
    acceptedBy.delete(id)
  }

  return {
    invite,
    resend,
    revoke,
    read,
    removeMember,
    accept,
    forget,
  }
}

/**
 * `POST /auth/dev/accept`: accepts a pending stand-in invite by the id its link names, as the development
 * person of its email, with the WorkOS user id `dev:<email>`, even when a WorkOS account has the email. That
 * person is made, when there is none, in the transaction that accepts, so a failed accept leaves no one
 * behind. Then answers as `/auth/callback` does. Not found unless the stand-in is given.
 */
export function devInviteRoutes({ db, dev }: { db: Db; dev: DevInvitesSettings | null }): Hono<Env> {
  const app = new Hono<Env>()

  app.post('/auth/dev/accept', async (c) => {
    if (!dev) return c.json(error('Not found'), 404)
    const input = await body(c.req.raw, AcceptDevInvite)
    if (input instanceof Response) return input
    const [invite] = await db
      .select({ email: invites.email })
      .from(invites)
      .innerJoin(workspaces, eq(workspaces.id, invites.workspaceId))
      .where(and(eq(invites.providerInviteId, input.invite), isNull(workspaces.workosOrganizationId)))
    if (!invite) return c.json(error('No such invite'), 404)
    const unusable = () => c.json(error('This invite has expired, was revoked or was already used'), 400)
    if ((await dev.provider.read(input.invite)).state !== 'pending') return unusable()

    const { email } = invite
    // Only the development person of the email: a WorkOS account with it is never signed in from here.
    const workosUserId = `dev:${email}`
    const [known] = await db.select({ id: users.id }).from(users).where(eq(users.workosUserId, workosUserId))
    const person = { id: known?.id ?? newId(), workosUserId }
    dev.provider.accept(input.invite, person.workosUserId)
    let open: string
    try {
      open = await db.transaction(async (tx) => {
        if (!known) await tx.insert(users).values({ ...person, email })
        // Only the stand-in's invites: a WorkOS invite of the same email is for WorkOS to say.
        const accepting = await acceptInvites(tx, { workos: null, dev: dev.provider }, { ...person, email })
        if (!accepting.open) throw new NotAccepted()
        return accepting.open
      })
    } catch (e) {
      if (e instanceof NotAccepted) return unusable()
      throw e
    } finally {
      dev.provider.forget(input.invite)
    }
    const { token, expiresAt } = signSessionToken(dev.secret, { userId: person.id, workosSessionId: null })
    return c.json({ token, expiresAt, open } satisfies SignedIn)
  })

  return app
}
