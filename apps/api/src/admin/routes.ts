// Early access's routes. Under /admin, for admins only, as if they didn't exist for anyone else: Dazbee
// invites (list, invite, resend, cancel, and remove a person who joined) and the waiting list (list, invite a
// request, dismiss it). And the public request to join, limited per address, which answers the same whoever
// sends it.
import { type Context, Hono } from 'hono'

import type { Db } from '@dazbee/db'
import {
  type AccessRequest,
  CreateDazbeeInvite,
  type DazbeeInvite,
  type DazbeeInvites,
  RequestAccess,
} from '@dazbee/schema'

import { body, type Env, error } from '../http.ts'
import { dazbeeInvitesProvider, type InvitesProviders } from '../members/invites-provider.ts'
import type { SessionOf } from '../sign-in/session.ts'
import { type Admins, requireAdmin } from './admins.ts'
import {
  cancelDazbeeInvite,
  inviteToDazbee,
  listDazbeeInvites,
  removeInvitedPerson,
  resendDazbeeInvite,
} from './dazbee-invites.ts'
import type { TurnstileCheck } from './turnstile.ts'
import { dismissRequest, inviteRequest, listAccessRequests, requestAccess, type RequestLimit } from './waiting-list.ts'

export function adminRoutes({
  db,
  sessionOf,
  admins,
  invites,
}: {
  db: Db
  sessionOf: SessionOf
  admins: Admins
  invites: InvitesProviders
}): Hono<Env> {
  const app = new Hono<Env>()
  const provider = dazbeeInvitesProvider(invites)
  const notSetUp = (c: Context<Env>) => c.json(error('Invites are not set up'), 404)
  const noSuch = (c: Context<Env>, what: string) => c.json(error(`No such ${what}`), 404)

  app.use('/admin/*', requireAdmin(db, sessionOf, admins))

  app.get('/admin/invites', async (c) => c.json((await listDazbeeInvites(db)) satisfies DazbeeInvites))

  app.post('/admin/invites', async (c) => {
    const input = await body(c.req.raw, CreateDazbeeInvite)
    if (input instanceof Response) return input
    if (!provider) return notSetUp(c)
    return c.json((await inviteToDazbee(db, provider, c.var.session.userId, input.email)) satisfies DazbeeInvite, 201)
  })

  app.post('/admin/invites/:inviteId/resend', async (c) => {
    if (!provider) return notSetUp(c)
    const invite = await resendDazbeeInvite(db, provider, c.req.param('inviteId'))
    return invite ? c.json(invite satisfies DazbeeInvite) : noSuch(c, 'invite')
  })

  app.delete('/admin/invites/:inviteId', async (c) => {
    if (!provider) return notSetUp(c)
    const cancelled = await cancelDazbeeInvite(db, provider, c.req.param('inviteId'))
    if (cancelled === 'accepted') return c.json(error('This invite was already accepted'), 409)
    return cancelled ? c.body(null, 204) : noSuch(c, 'invite')
  })

  app.post('/admin/invites/:inviteId/remove', async (c) =>
    (await removeInvitedPerson(db, c.req.param('inviteId'))) ? c.body(null, 204) : noSuch(c, 'person'),
  )

  app.get('/admin/access-requests', async (c) => c.json((await listAccessRequests(db)) satisfies AccessRequest[]))

  app.post('/admin/access-requests/:requestId/invite', async (c) => {
    if (!provider) return notSetUp(c)
    const invite = await inviteRequest(db, provider, c.var.session.userId, c.req.param('requestId'))
    return invite ? c.json(invite satisfies DazbeeInvite, 201) : noSuch(c, 'request')
  })

  app.delete('/admin/access-requests/:requestId', async (c) =>
    (await dismissRequest(db, c.req.param('requestId'))) ? c.body(null, 204) : noSuch(c, 'request'),
  )

  return app
}

/**
 * `POST /access-requests`: a request to join, needing no session, answered 204 whoever sends it. The 6th from
 * one address within the hour is answered 429, and with a Turnstile check, one whose token Cloudflare doesn't
 * vouch for is answered 400; neither stores anything. The address is the person's as Cloudflare saw it,
 * `CF-Connecting-IP`, which the web app's server passes on; the API is reached only through it.
 */
export function accessRequestRoutes({
  db,
  limit,
  turnstile,
}: {
  db: Db
  limit: RequestLimit
  turnstile: TurnstileCheck | null
}): Hono<Env> {
  const app = new Hono<Env>()

  app.post('/access-requests', async (c) => {
    const address = c.req.header('cf-connecting-ip')?.trim() || null
    if (!limit.take(address ?? 'unknown')) return c.json(error('Too many requests; try again later'), 429)
    const input = await body(c.req.raw, RequestAccess)
    if (input instanceof Response) return input
    if (turnstile && !(input.turnstileToken && (await turnstile(input.turnstileToken, address))))
      return c.json(error('The check that you are a person failed; try again'), 400)
    await requestAccess(db, input)
    return c.body(null, 204)
  })

  return app
}
