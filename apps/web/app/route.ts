// `/` opens the person's workspace to open, the one they used last. A route handler and not a page,
// because a person with no workspace left is signed out, and only a route handler can delete a cookie.
import { type NextRequest, NextResponse } from 'next/server'

import { workspacePath } from '@/lib/brand-routes.ts'
import { findMe } from '@/lib/server/api.ts'
import { endSession } from '@/lib/server/sign-in.ts'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const me = await findMe()
  if (!me) return NextResponse.redirect(new URL('/login', request.url), 303)
  if (!me.open) return endSession(request)
  return NextResponse.redirect(new URL(workspacePath(me.open), request.url), 303)
}
