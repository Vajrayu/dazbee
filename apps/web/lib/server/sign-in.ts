// Sign-in's cookies (#58): the session token from the API, the state that ties a WorkOS callback to
// the sign-in this browser started, and the token of the invite that sign-in started from, so a sign-in
// that fails is tried again with it. All are httpOnly, so no script can read them. Starting a sign-in sets
// the last two. Each sign-in the web app refuses or starts again is written to the server's stdout.
import 'server-only'

import { randomBytes } from 'node:crypto'

import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

import { InvitationToken } from '@dazbee/schema'

import { isPilotHost } from '@/lib/pilot-host.ts'

import { SESSION_COOKIE, signInLink, signOutLink } from './api.ts'

export { SESSION_COOKIE } from './api.ts'

/** The site a sign-in starts on: its origin, and its Host header, which says whether it is the pilot host. */
export interface SignInSite {
  origin: string | null
  host: string | null
}

export const STATE_COOKIE = 'dazbee_sign_in_state'
export const INVITATION_COOKIE = 'dazbee_sign_in_invitation'

/** How long a started sign-in may take to come back, and its invite's token is kept. */
export const STATE_SECONDS = 10 * 60

/** How the state of a sign-in that /callback started again begins; no other state does. */
export const AGAIN_STATE = 'again_'

/** Cookie settings for an origin: Secure whenever the site is served over https. */
export const cookieOptions = (origin: string | null | undefined) => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
  secure: origin?.startsWith('https:') ?? false,
})

/**
 * A 303 to `to`: a path on this site, which stays relative so the browser keeps the address it used
 * (behind a proxy the server's own address is not the site's), or another site's address.
 */
export const seeOther = (to: string) => new NextResponse(null, { status: 303, headers: { location: to } })

/**
 * Starts a sign-in in this browser: WorkOS's sign-in link, carrying the invite's token when it is one an
 * invite could have, with the state and that token kept in short-lived cookies for WorkOS's answer at
 * /callback. On the pilot host, WorkOS answers at that host's own /callback. `again` marks a sign-in that
 * /callback starts again. Null when sign-in is not set up.
 */
export async function startSignIn(invitationToken: unknown, site: SignInSite, again = false): Promise<string | null> {
  // Hex, so no fresh state begins like one started again.
  const state = `${again ? AGAIN_STATE : ''}${randomBytes(24).toString('hex')}`
  const token = InvitationToken.safeParse(invitationToken)
  const pilotCallback = site.origin && isPilotHost(site.host) ? new URL('/callback', site.origin).href : undefined
  const url = await signInLink(state, token.data, pilotCallback)
  if (!url) return null
  const jar = await cookies()
  const options = { ...cookieOptions(site.origin), maxAge: STATE_SECONDS }
  jar.set(STATE_COOKIE, state, options)
  if (token.success) jar.set(INVITATION_COOKIE, token.data, options)
  else jar.delete(INVITATION_COOKIE)
  return url
}

/**
 * Writes what became of a sign-in the web app refused, couldn't finish or started again to the server's
 * stdout, as one JSON line with its reason. It never holds an email, a code or a token.
 */
export function logSignIn(outcome: string, fields: Record<string, string | number | null> = {}) {
  console.log(JSON.stringify({ event: 'sign-in', outcome, ...fields }))
}

/** Forgets the session token, ends the WorkOS session too when there was one, and sends the person to it or to sign in. */
export async function endSession() {
  return seeOther(await forgetSession())
}

/**
 * Forgets the session token and ends the WorkOS session too when there was one, from a route handler or
 * a server action; gives where the person goes next: WorkOS's sign-out, or sign in.
 */
export async function forgetSession(): Promise<string> {
  const jar = await cookies()
  const logoutUrl = jar.has(SESSION_COOKIE) ? await signOutLink().catch(() => null) : null
  jar.delete(SESSION_COOKIE)
  return logoutUrl ?? '/login'
}

/** Forgets the session token alone, for a person whose account is deleted: their WorkOS session went with it. */
export async function forgetDeletedSession() {
  const jar = await cookies()
  jar.delete(SESSION_COOKIE)
}
