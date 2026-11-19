// The signed-in person's own routes: who they are, the workspaces they are a member of, and the one to open;
// what deleting their account would do, and deleting it.
import { Hono } from 'hono'

import type { Db } from '@dazbee/db'
import { type AccountDeletion, DeleteAccount, type DeleteAccountRefused, type Me } from '@dazbee/schema'

import { body, type Env, error } from '../http.ts'
import { logError } from '../log.ts'
import { accountDeletion, AccountRefusal, deleteAccount } from './delete-account.ts'
import { findMe } from './me.ts'
import { type Deleters, finishSoon } from './pending-deletions.ts'

export function meRoutes({
  db,
  deleters,
  endWorkosSession,
}: {
  db: Db
  deleters: Deleters
  /** Ends the WorkOS session the request's session token came from, if any. */
  endWorkosSession: (request: Request) => Promise<void>
}): Hono<Env> {
  const app = new Hono<Env>()

  app.get('/me', async (c) => {
    const me = await findMe(db, c.var.session.userId)
    return me ? c.json(me satisfies Me) : c.json(error('Sign in first'), 401)
  })

  app.get('/me/deletion', async (c) =>
    c.json((await accountDeletion(db, c.var.session.userId)) satisfies AccountDeletion),
  )

  // Deleting the account, confirmed with its email and the workspaces it deletes: 400 for another email, 404
  // once it is deleted already, and 409 naming the workspaces the person owns with other members, who hand
  // over Owner first, or when the workspaces it deletes are no longer those confirmed. Once the rows are
  // deleted it ends the person's WorkOS session and answers, and deletes what is outside the database after.
  app.delete('/me', async (c) => {
    const input = await body(c.req.raw, DeleteAccount)
    if (input instanceof Response) return input
    let pending: string[]
    try {
      pending = await deleteAccount(db, deleters, c.var.session.userId, input)
    } catch (e) {
      if (!(e instanceof AccountRefusal)) throw e
      return c.json({ ...error(e.message), handOver: e.handOver } satisfies DeleteAccountRefused, e.status)
    }
    await endWorkosSession(c.req.raw).catch((e: unknown) => logError('workos-session-not-ended', e))
    finishSoon(db, deleters, pending)
    return c.body(null, 204)
  })

  return app
}
