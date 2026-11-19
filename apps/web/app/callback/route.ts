// WorkOS sends the person back here after sign-in (#58): check the state is the one this browser
// started with, swap the code for a session at the API, keep its token in an httpOnly cookie, and
// open the workspace sign-in chose. A sign-in early access refuses goes back to sign in with its reason.
// A sign-in that started from an invite and fails goes back to sign in with the invite's token, so trying
// again still accepts it. On the pilot host, sign-in opens the early-access admin page, that host's `/`.
import { cookies } from 'next/headers'
import type { NextRequest } from 'next/server'

import { workspacePath } from '@/lib/brand-routes.ts'
import { isPilotHost } from '@/lib/pilot-host.ts'
import { completeSignIn } from '@/lib/server/api.ts'
import { cookieOptions, INVITATION_COOKIE, seeOther, SESSION_COOKIE, STATE_COOKIE } from '@/lib/server/sign-in.ts'

export async function GET(request: NextRequest) {
  const jar = await cookies()
  const code = request.nextUrl.searchParams.get('code')
  const state = request.nextUrl.searchParams.get('state')
  const expected = jar.get(STATE_COOKIE)?.value
  const invitationToken = jar.get(INVITATION_COOKIE)?.value
  jar.delete(STATE_COOKIE)
  jar.delete(INVITATION_COOKIE)
  const failed = (error = '1') => {
    const again = new URLSearchParams({ error, ...(invitationToken ? { invitation_token: invitationToken } : {}) })
    return seeOther(`/login?${again}`)
  }
  if (!code || !state || !expected || state !== expected) return failed()
  let session
  try {
    session = await completeSignIn(code)
  } catch {
    return failed()
  }
  if ('refused' in session) return failed(session.refused)
  jar.set(SESSION_COOKIE, session.token, {
    ...cookieOptions(request.nextUrl.origin),
    expires: new Date(session.expiresAt),
  })
  return seeOther(isPilotHost(request.headers.get('host')) ? '/' : workspacePath(session.open))
}
