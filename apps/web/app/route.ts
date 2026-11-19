// `/` opens the person's workspace to open, the one they used last. A route handler and not a page,
// because a person with no workspace left is signed out, and only a route handler can delete a cookie.
import { workspacePath } from '@/lib/brand-routes.ts'
import { findMe } from '@/lib/server/api.ts'
import { endSession, seeOther } from '@/lib/server/sign-in.ts'

export const dynamic = 'force-dynamic'

export async function GET() {
  const me = await findMe()
  if (!me) return seeOther('/login')
  if (!me.open) return endSession()
  return seeOther(workspacePath(me.open))
}
