// A development invite's link: accepts the invite at the API as the person of its email, keeps their
// session in the httpOnly cookie as /callback does, and opens the invited workspace. Not found when the
// API has no such invite, or no development accept. A link that was revoked, expired or used opens
// sign-in, which says so.
import { cookies } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'

import { RecordId } from '@dazbee/schema'

import { workspacePath } from '@/lib/brand-routes.ts'
import { ApiFailure } from '@/lib/server/api.ts'
import { acceptDevInvite } from '@/lib/server/members.ts'
import { cookieOptions, SESSION_COOKIE } from '@/lib/server/sign-in.ts'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const invite = RecordId.safeParse(request.nextUrl.searchParams.get('invite'))
  if (!invite.success) return notFound()
  let session
  try {
    session = await acceptDevInvite(invite.data)
  } catch (e) {
    if (e instanceof ApiFailure && e.status === 404) return notFound()
    if (e instanceof ApiFailure && e.status === 400)
      return NextResponse.redirect(new URL('/login?invite=unusable', request.url), 303)
    throw e
  }
  ;(await cookies()).set(SESSION_COOKIE, session.token, {
    ...cookieOptions(request.nextUrl.origin),
    expires: new Date(session.expiresAt),
  })
  return NextResponse.redirect(new URL(workspacePath(session.open), request.url), 303)
}

function notFound() {
  return new Response('Not found', { status: 404 })
}
