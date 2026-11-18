// The signed-in person's own route: who they are, the workspaces they are a member of, and the one to open.
import { Hono } from 'hono'

import type { Db } from '@dazbee/db'
import type { Me } from '@dazbee/schema'

import { type Env, error } from '../http.ts'
import { findMe } from './me.ts'

export function meRoutes({ db }: { db: Db }): Hono<Env> {
  const app = new Hono<Env>()

  app.get('/me', async (c) => {
    const me = await findMe(db, c.var.session.userId)
    return me ? c.json(me satisfies Me) : c.json(error('Sign in first'), 401)
  })

  return app
}
