// Sign-in's cookies (#58): the session token from the API, the state that ties a WorkOS callback to
// the sign-in this browser started, and the token of the invite that sign-in started from, so a sign-in
// that fails is tried again with it. All are httpOnly, so no script can read them.
import 'server-only'

import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

import { SESSION_COOKIE, signOutLink } from './api.ts'

export { SESSION_COOKIE } from './api.ts'

export const STATE_COOKIE = 'dazbee_sign_in_state'
export const INVITATION_COOKIE = 'dazbee_sign_in_invitation'

/** How long a started sign-in may take to come back, and its invite's token is kept. */
export const STATE_SECONDS = 10 * 60

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
