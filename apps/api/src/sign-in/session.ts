// Who is asking. A signed-in person sends the session token the API gave them at sign-in (#58) as a
// bearer token; a development session can stand in locally and in CI, and every route of a workspace
// checks the person's membership there.
import { and, eq } from 'drizzle-orm'

import { brands, type Db, memberships, users, workspaces } from '@dazbee/db'
import { readSessionToken } from '@dazbee/session-token'

/** Who is asking. */
export interface Session {
  userId: string
}

/** Finds the session of a request, or null when it has none. */
export type SessionOf = (request: Request) => Session | null | Promise<Session | null>

export const DEV_WORKSPACE = { id: 'dev-workspace', name: 'Development agency' }
export const DEV_BRANDS = [
  { id: 'dev-brand-coffee', name: 'Harbour Coffee' },
  { id: 'dev-brand-cycles', name: 'Northline Cycles' },
]

/** The one development user, a person like any other, so what names them (a version they save) can. */
export const DEV_USER = { id: 'dev-user', workosUserId: 'dev-user', email: 'dev@localhost', name: 'Development user' }

/**
 * Every request is the one development user, whom the seed makes the development workspace's first Owner.
 * Never on in production.
 */
export const devSession: SessionOf = () => ({ userId: DEV_USER.id })

/**
 * Adds the development workspace, its brands and its user, unless they are there already, and makes the
 * user its Owner while the workspace has none: once Owner is handed over, the new Owner keeps it.
 */
export async function seedDevelopment(db: Db) {
  await db.insert(workspaces).values(DEV_WORKSPACE).onConflictDoNothing()
  await db
    .insert(brands)
    .values(DEV_BRANDS.map((c) => ({ ...c, workspaceId: DEV_WORKSPACE.id })))
    .onConflictDoNothing()
  await db.insert(users).values(DEV_USER).onConflictDoNothing()
  const [owner] = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.workspaceId, DEV_WORKSPACE.id), eq(memberships.role, 'owner')))
  if (owner) return
  await db
    .insert(memberships)
    .values({ workspaceId: DEV_WORKSPACE.id, userId: DEV_USER.id, role: 'owner' })
    .onConflictDoNothing({ target: [memberships.workspaceId, memberships.userId] })
}

/** The bearer token of a request, or null. */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization')
  const match = header && /^Bearer ([\w.-]+)$/.exec(header)
  return match?.[1] ?? null
}

/** Sessions from bearer tokens; each route of a workspace then checks the person is a member there. */
export function tokenSession(secret: string): SessionOf {
  return (request) => {
    const token = bearerToken(request)
    const payload = token ? readSessionToken(secret, token) : null
    return payload ? { userId: payload.userId } : null
  }
}

/** The first of these that finds a session. */
export function firstSession(...ways: SessionOf[]): SessionOf {
  return async (request) => {
    for (const way of ways) {
      const session = await way(request)
      if (session) return session
    }
    return null
  }
}

/**
 * How the API finds who is asking: a session token first, wherever there is a secret to read it with
 * (WorkOS sign-in, or the development session given SESSION_SECRET, so a check in the browser can sign
 * in as a member in another role), then the development session when it is on.
 */
export function sessionOfRequest({ secret, dev }: { secret: string | null; dev: boolean }): SessionOf {
  return firstSession(...(secret ? [tokenSession(secret)] : []), ...(dev ? [devSession] : []))
}

/** The name a person gave at sign-in: empty for one who gave none, and for the development user. */
export async function userName(db: Db, userId: string): Promise<string> {
  const [user] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId))
  return user?.name ?? ''
}
