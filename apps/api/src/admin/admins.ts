// Dazbee's admins during early access: the people whose email is in the API's ADMIN_EMAILS. They alone use
// the /admin routes, which answer anyone else 404, and sign-in always lets them in.
import { eq } from 'drizzle-orm'
import type { MiddlewareHandler } from 'hono'

import { type Db, users } from '@dazbee/db'

import { type Env, error } from '../http.ts'
import type { SessionOf } from '../sign-in/session.ts'

/** The admins' emails, in lower case; empty when ADMIN_EMAILS names none. */
export type Admins = ReadonlySet<string>

/** The admins from `ADMIN_EMAILS`, a comma-separated list of emails. */
export function adminEmails(env: NodeJS.ProcessEnv = process.env): Admins {
  return new Set(
    (env.ADMIN_EMAILS ?? '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  )
}

/**
 * Answers 404 "Not found" unless the request's session is an admin's, as if the route didn't exist; otherwise
 * puts their session on the context. An admin is known by the email they last signed in with.
 */
export function requireAdmin(db: Db, sessionOf: SessionOf, admins: Admins): MiddlewareHandler<Env> {
  return async (c, next) => {
    const session = admins.size > 0 ? await sessionOf(c.req.raw) : null
    const email = session && (await emailOf(db, session.userId))
    if (!session || !email || !admins.has(email.toLowerCase())) return c.json(error('Not found'), 404)
    c.set('session', session)
    await next()
  }
}

/** The email the person last signed in with, or null when there is no such person. */
async function emailOf(db: Db, userId: string): Promise<string | null> {
  const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId))
  return user?.email ?? null
}
