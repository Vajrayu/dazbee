// Session tokens are base64url(JSON payload) "." base64url(HMAC-SHA256 of that text), keyed by
// SESSION_SECRET, which only the API has. The web app keeps one in an httpOnly cookie.
import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * What a session token carries: the person and their WorkOS session, never a workspace, which each page
 * names (ADR-0016), nor a role, which can change.
 */
export interface SessionTokenPayload {
  userId: string
  /** The WorkOS session it came from, so signing out can end that too; null when there was none. */
  workosSessionId: string | null
  /** Expiry, in milliseconds since the epoch. */
  expiresAt: number
}

/** How long a session lasts before the person signs in again. */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

const sign = (secret: string, text: string) => createHmac('sha256', secret).update(text).digest('base64url')

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
