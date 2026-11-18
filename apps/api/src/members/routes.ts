// The routes of a workspace's members and invites: every member may read the members, a limited one seeing
// only their own brands of each, and anyone but the Owner leaves; only an Owner or Admin changes a member's
// role or brands or removes them, and only the Owner hands over Owner; only an Owner or Admin reads the
// pending invites, whose links let anyone in, and invites, resends or revokes. Each is mounted under the
// workspace it is for.
import { type Context, Hono } from 'hono'

import type { Db } from '@dazbee/db'
import { CreateInvite, type Invite, UpdateMember, type WorkspaceMember } from '@dazbee/schema'

import { body, type Env, error, requireManager } from '../http.ts'
import { listMembers } from '../workspace/workspace.ts'
import { seenBy } from './brand-limits.ts'
import { findInviter, inviteMember, listInvites, resendInvite, revokeInvite } from './invites.ts'
import { invitesProviderFor, type InvitesProviders } from './invites-provider.ts'
import { changeMember, handOverOwner, leaveWorkspace, removeMember } from './members.ts'

export function memberRoutes({ db, invites }: { db: Db; invites: InvitesProviders }): Hono<Env> {
  const app = new Hono<Env>()

  /** The member asking, as an inviter, and their workspace's invites provider; null when it has none here. */
  async function inviting(c: Context<Env>) {
    const inviter = await findInviter(db, c.var.membership.workspaceId, c.var.session.userId)
    const provider = inviter && invitesProviderFor(invites, inviter.organizationId)
    return inviter && provider ? { inviter, provider } : null
  }
  const actorOf = (c: Context<Env>) => ({ workspaceId: c.var.membership.workspaceId, userId: c.var.session.userId })
  const notSetUp = (c: Context<Env>) => c.json(error('Invites are not set up for this workspace'), 404)
  const noSuchInvite = (c: Context<Env>) => c.json(error('No such invite'), 404)

  app.get('/members', async (c) => {
    const { workspaceId, brandIds } = c.var.membership
    return c.json(seenBy(brandIds, await listMembers(db, workspaceId)) satisfies WorkspaceMember[])
  })

  app.patch('/members/:userId', requireManager, async (c) => {
    const input = await body(c.req.raw, UpdateMember)
    if (input instanceof Response) return input
    return c.json((await changeMember(db, actorOf(c), c.req.param('userId'), input)) satisfies WorkspaceMember)
  })

  app.delete('/members/:userId', requireManager, async (c) => {
    await removeMember(db, invites, actorOf(c), c.req.param('userId'))
    return c.body(null, 204)
  })

  app.post('/members/:userId/owner', async (c) => {
    await handOverOwner(db, actorOf(c), c.req.param('userId'))
    return c.body(null, 204)
  })

  app.post('/leave', async (c) => {
    await leaveWorkspace(db, invites, actorOf(c))
    return c.body(null, 204)
  })

  app.get('/invites', requireManager, async (c) =>
    c.json((await listInvites(db, c.var.membership.workspaceId)) satisfies Invite[]),
  )

  app.post('/invites', requireManager, async (c) => {
    const input = await body(c.req.raw, CreateInvite)
    if (input instanceof Response) return input
    const ready = await inviting(c)
    if (!ready) return notSetUp(c)
    return c.json((await inviteMember(db, ready.provider, ready.inviter, input)) satisfies Invite, 201)
  })

  app.post('/invites/:inviteId/resend', requireManager, async (c) => {
    const ready = await inviting(c)
    if (!ready) return notSetUp(c)
    const invite = await resendInvite(db, ready.provider, c.var.membership.workspaceId, c.req.param('inviteId'))
    return invite ? c.json(invite satisfies Invite) : noSuchInvite(c)
  })

  app.delete('/invites/:inviteId', requireManager, async (c) => {
    const ready = await inviting(c)
    if (!ready) return notSetUp(c)
    const revoked = await revokeInvite(db, ready.provider, c.var.membership.workspaceId, c.req.param('inviteId'))
    if (revoked === 'accepted') return c.json(error('This invite was already accepted'), 409)
    return revoked ? c.body(null, 204) : noSuchInvite(c)
  })

  return app
}
