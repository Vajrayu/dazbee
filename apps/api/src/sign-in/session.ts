// Who is asking. A signed-in person sends the session token the API gave them at sign-in (#58) as a
// bearer token; a development session can stand in locally and in CI, and every route of a workspace
// checks the person's membership there.
import { createHmac, timingSafeEqual } from 'node:crypto'

import { and, eq } from 'drizzle-orm'

import { brands, type Db, memberships, users, workspaces } from '@dazbee/db'

/** Who is asking. */
export interface Session {
  userId: string
}

/** Finds the session of a request, or null when it has none. */
export type SessionOf = (request: Request) => Session | null | Promise<Session | null>

// Session tokens are base64url(JSON payload) "." base64url(HMAC-SHA256 of that text), keyed by
// SESSION_SECRET, which only the API has. The web app keeps one in an httpOnly cookie.

/**
 * What a session token carries: the person and their WorkOS session, never a workspace, which each page
 * names (ADR-0016), nor a role, which can change.
 */
export interface SessionTokenPayload extends Session {
  /** The WorkOS session it came from, so signing out can end that too; null when there was none. */
  workosSessionId: string | null
  /** Expiry, in milliseconds since the epoch. */
  expiresAt: number
}

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

/** How long a session lasts before the person signs in again. */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

const sign = (secret: string, text: string) => createHmac('sha256', secret).update(text).digest('base64url')

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

/** The session secret from the environment; refuses one too short to be a real key. */
export function sessionSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = env.SESSION_SECRET
  if (!secret || secret.length < 32) throw new Error('SESSION_SECRET must be set to at least 32 characters')
  return secret
}

export function signSessionToken(
  secret: string,
  session: Omit<SessionTokenPayload, 'expiresAt'>,
  now = Date.now(),
): { token: string; expiresAt: number } {
  const expiresAt = now + SESSION_TTL_MS
  const text = Buffer.from(JSON.stringify({ ...session, expiresAt } satisfies SessionTokenPayload)).toString(
    'base64url',
  )
  return { token: `${text}.${sign(secret, text)}`, expiresAt }
}

/**
 * The token's payload when it is signed with `secret` and unexpired, with only the fields a payload has:
 * anything else a token carries, such as a workspace, is dropped. Otherwise null.
 */
export function readSessionToken(secret: string, token: string, now = Date.now()): SessionTokenPayload | null {
  const [text, signature, extra] = token.split('.')
  if (!text || !signature || extra !== undefined) return null
  const expected = Buffer.from(sign(secret, text))
  const given = Buffer.from(signature)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null
  let payload: Partial<Record<keyof SessionTokenPayload, unknown>>
  try {
    payload = JSON.parse(Buffer.from(text, 'base64url').toString('utf8')) as typeof payload
  } catch {
    return null
  }
  const { userId, workosSessionId, expiresAt } = payload ?? {}
  if (typeof userId !== 'string') return null
  if (typeof expiresAt !== 'number' || expiresAt <= now) return null
  return { userId, workosSessionId: typeof workosSessionId === 'string' ? workosSessionId : null, expiresAt }
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
