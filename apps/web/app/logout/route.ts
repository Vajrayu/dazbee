// Sign out (#58): forget the session token, and end the WorkOS session too when there was one.
import { type NextRequest, NextResponse } from 'next/server'

import { endSession } from '@/lib/server/sign-in.ts'

export async function POST(request: NextRequest) {
  // Only this site's own sign-out button may sign the person out.
  if (request.headers.get('sec-fetch-site') === 'cross-site') return new NextResponse(null, { status: 403 })
  return endSession(request)
}
