// The development stand-in for invites, for a workspace with no WorkOS organization, such as the
// development workspace, and for Dazbee invites when WorkOS sign-in isn't set up; given only when the
// development session is on. It keeps its invites in our tables alone, and its link is the web app's
// /dev/accept, whose accept route signs in the person with the invite's email, made up on first use, and
// accepts the invite as WorkOS would: a Dazbee invite's person gets a workspace of their own when they have
// none, with no WorkOS organization.
import { and, eq, isNull } from 'drizzle-orm'
import { Hono } from 'hono'

import { dazbeeInvites, type Db, invites, memberships, newId, type Tx, users, workspaces } from '@dazbee/db'
import { AcceptDevInvite, type SignedIn } from '@dazbee/schema'

import { acceptDazbeeInvite } from '../admin/dazbee-invites.ts'
import { body, type Env, error } from '../http.ts'
import { inviteExpiry, type InvitesProvider, type ProviderInvite } from '../members/invites-provider.ts'
import { workspaceToOpen } from '../workspace/workspace.ts'
import { signSessionToken } from './session.ts'
import { acceptInvites } from './sign-in.ts'

/** The stand-in: an invites provider whose invites are accepted through its accept route. */
export interface DevInvites extends InvitesProvider {
  /** Marks the invite accepted by the person, as their accepting it with WorkOS would. */
  accept(id: string, workosUserId: string): void
  /** Drops what `accept` marked, once our table holds the invite as accepted, or accepting failed. */
  forget(id: string): void
}

/**
 * The stand-in, with the secret its accept route signs sessions with, and whether it also sends Dazbee
 * invites, which it does when WorkOS sign-in isn't set up.
 */
export interface DevInvitesSettings {
  provider: DevInvites
  secret: string
  dazbee?: boolean
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
      .unionAll(
        db
          .select({
            expiresAt: dazbeeInvites.expiresAt,
            acceptedAt: dazbeeInvites.acceptedAt,
            revokedAt: dazbeeInvites.revokedAt,
          })
          .from(dazbeeInvites)
          .where(eq(dazbeeInvites.providerInviteId, id)),
      )
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
 * `POST /auth/dev/accept`: accepts a pending stand-in invite by the id its link names, a workspace's or a
 * Dazbee invite, as the development person of its email, with the WorkOS user id `dev:<email>`, even when a
 * WorkOS account has the email. That person is made, when there is none, in the transaction that accepts,
 * so a failed accept leaves no one behind. Then answers as `/auth/callback` does. Not found unless the
 * stand-in is given.
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
    // A Dazbee invite only when WorkOS isn't its provider, as the stand-in is then given for no other.
    const [dazbee] = invite
      ? []
      : await db
          .select({ id: dazbeeInvites.id, email: dazbeeInvites.email })
          .from(dazbeeInvites)
          .where(eq(dazbeeInvites.providerInviteId, input.invite))
    if (!invite && !(dazbee && dev.dazbee)) return c.json(error('No such invite'), 404)
    const unusable = () => c.json(error('This invite has expired, was revoked or was already used'), 400)
    if ((await dev.provider.read(input.invite)).state !== 'pending') return unusable()

    const email = invite?.email ?? dazbee?.email ?? ''
    // Only the development person of the email: a WorkOS account with it is never signed in from here.
    const workosUserId = `dev:${email}`
    const [known] = await db.select({ id: users.id }).from(users).where(eq(users.workosUserId, workosUserId))
    const person = { id: known?.id ?? newId(), workosUserId }
    dev.provider.accept(input.invite, person.workosUserId)
    let open: string
    try {
      open = await db.transaction(async (tx) => {
        if (!known) await tx.insert(users).values({ ...person, email })
        if (dazbee) return joinDazbee(tx, dazbee.id, person.id, email)
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

/**
 * Accepts a Dazbee invite for the person, and answers the workspace they open: the one they used last, else
 * one of their own, made here with no WorkOS organization. Throws `NotAccepted` when it is no longer pending.
 */
async function joinDazbee(tx: Tx, inviteId: string, userId: string, email: string): Promise<string> {
  if (!(await acceptDazbeeInvite(tx, inviteId))) throw new NotAccepted()
  const open = await workspaceToOpen(tx, userId)
  if (open) return open
  const id = newId()
  await tx.insert(workspaces).values({ id, name: email.split('@')[0] || email })
  await tx.insert(memberships).values({ workspaceId: id, userId, role: 'owner' })
  return id
}
