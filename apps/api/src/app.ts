// The API: every area's routes on one app. Each workspace is at /workspaces/:workspaceId, for its members
// only: a workspace the person is not a member of, a brand or design of another workspace, and a brand outside
// a limited member's, are answered as if they didn't exist (ADR-0016). Outside a workspace there are only
// /health, sign-in's /auth/* (with the development invites' accept route) and the person's own /me. Every
// route below a brand reads its brand from `brandScope`, and an `Invalid*` error answers 400 here, and a
// `MemberRefusal` its own status, whichever route throws it.
import { Hono } from 'hono'

import type { Db } from '@dazbee/db'
import type { Storage } from '@dazbee/storage'

import { InvalidUpload } from './assets/assets.ts'
import { assetRoutes } from './assets/routes.ts'
import { InvalidKit } from './brand-kits/brand-kits.ts'
import { brandKitRoutes } from './brand-kits/routes.ts'
import { InvalidFont } from './fonts/fonts.ts'
import { fontRoutes } from './fonts/routes.ts'
import { brandScope, type Env, error, membershipScope, requireSession } from './http.ts'
import { meRoutes } from './me/routes.ts'
import { InvalidLimit } from './members/brand-limits.ts'
import { InvalidInvite, InviteConflict } from './members/invites.ts'
import type { InvitesProvider, InvitesProviders } from './members/invites-provider.ts'
import { MemberRefusal } from './members/members.ts'
import { memberRoutes } from './members/routes.ts'
import { devInviteRoutes, type DevInvitesSettings } from './sign-in/dev-invites.ts'
import { signInRoutes } from './sign-in/routes.ts'
import type { SessionOf } from './sign-in/session.ts'
import type { SignInSettings } from './sign-in/sign-in.ts'
import { templateRoutes } from './templates/routes.ts'
import { versionRoutes } from './versions/routes.ts'
import { InvalidContent } from './workspace/designs.ts'
import { brandRoutes, workspaceRoutes } from './workspace/routes.ts'

export function createApp({
  db,
  storage,
  sessionOf,
  syncSecret,
  build,
  signIn = null,
  invites = { workos: null, dev: null },
}: {
  db: Db
  storage: Storage
  sessionOf: SessionOf
  syncSecret: string
  /** The commit this build is of, which /health names. */
  build: string
  signIn?: SignInSettings | null
  /** Who sends invites: WorkOS for a workspace with an organization, the development stand-in for one without. */
  invites?: { workos: InvitesProvider | null; dev: DevInvitesSettings | null }
}) {
  const app = new Hono<Env>()

  app.get('/health', (c) => c.json({ ok: true, build }))

  const providers: InvitesProviders = { workos: invites.workos, dev: invites.dev?.provider ?? null }
  app.route('/', signInRoutes({ db, signIn, invites: providers }))
  app.route('/', devInviteRoutes({ db, dev: invites.dev }))

  const signedIn = requireSession(sessionOf)
  const records = new Hono<Env>()
    .route('/', brandRoutes({ db, storage, syncSecret }))
    .route('/', versionRoutes({ db, storage }))
    .route('/', assetRoutes({ db, storage }))
    .route('/', templateRoutes({ db, storage }))
    .route('/', brandKitRoutes({ db }))
    .route('/', fontRoutes({ db, storage }))

  app.use('/me', signedIn)
  app.route('/', meRoutes({ db }))

  // `/workspaces/:workspaceId/*` matches the workspace's own path too.
  app.use('/workspaces/:workspaceId/*', signedIn, membershipScope(db))
  app.use('/workspaces/:workspaceId/brands/:brandId/*', brandScope(db))
  app.route('/workspaces/:workspaceId', workspaceRoutes({ db }))
  app.route('/workspaces/:workspaceId', memberRoutes({ db, invites: providers }))
  app.route('/workspaces/:workspaceId', records)

  // A refusal a route lets through answers 400 with its message; any other error is ours.
  app.onError((e, c) => {
    if (e instanceof MemberRefusal) return c.json(error(e.message), e.status)
    if (e instanceof InviteConflict) return c.json(error(e.message), 409)
    if (e instanceof InvalidContent) return c.json(error(`The design is not valid: ${e.message}`), 400)
    if (
      e instanceof InvalidUpload ||
      e instanceof InvalidKit ||
      e instanceof InvalidFont ||
      e instanceof InvalidInvite ||
      e instanceof InvalidLimit
    )
      return c.json(error(e.message), 400)
    console.error(e)
    return c.json(error('Something went wrong on our side'), 500)
  })

  return app
}
