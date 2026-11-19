// The signed-in person's own routes: who they are, the workspaces they are a member of, and the one to open;
// what deleting their account would do, and deleting it.
import { Hono } from 'hono'

import type { Db } from '@dazbee/db'
import { type AccountDeletion, DeleteAccount, type DeleteAccountRefused, type Me } from '@dazbee/schema'

import { body, type Env, error } from '../http.ts'
import { accountDeletion, AccountRefusal, deleteAccount } from './delete-account.ts'
import { findMe } from './me.ts'
import type { Deleters } from './pending-deletions.ts'

export function meRoutes({ db, deleters }: { db: Db; deleters: Deleters }): Hono<Env> {
  const app = new Hono<Env>()

  app.get('/me', async (c) => {
    const me = await findMe(db, c.var.session.userId)
    return me ? c.json(me satisfies Me) : c.json(error('Sign in first'), 401)
  })

  app.get('/me/deletion', async (c) =>
    c.json((await accountDeletion(db, c.var.session.userId)) satisfies AccountDeletion),
  )

  // Deleting the account, confirmed with its email: 400 for another email, 409 naming the workspaces the
  // person owns with other members, who hand over Owner first.
  app.delete('/me', async (c) => {
    const input = await body(c.req.raw, DeleteAccount)
    if (input instanceof Response) return input
    try {
      await deleteAccount(db, deleters, c.var.session.userId, input.email)
    } catch (e) {
      if (!(e instanceof AccountRefusal)) throw e
      return c.json({ ...error(e.message), handOver: e.handOver } satisfies DeleteAccountRefused, e.status)
    }
    return c.body(null, 204)
  })

  return app
}
