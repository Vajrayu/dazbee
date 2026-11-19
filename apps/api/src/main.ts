// The API server: migrates the database, then serves. Settings come from the environment only.
import { serve } from '@hono/node-server'

import { migrateDatabase, openDatabase } from '@dazbee/db'
import { openStorage, storageSettings } from '@dazbee/storage'
import { syncTokenSecret } from '@dazbee/sync-token'

import { createApp } from './app.ts'
import { workosInvites } from './members/invites-provider.ts'
import { devInvites } from './sign-in/dev-invites.ts'
import { seedDevelopment, sessionOfRequest, sessionSecret } from './sign-in/session.ts'
import { workosProvider, workosSettings } from './sign-in/sign-in.ts'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is not set')
const port = Number(process.env.API_PORT ?? 8787)
const syncSecret = syncTokenSecret()
const storage = openStorage(storageSettings())
// Local and CI storage starts empty; deployed buckets are made once, by hand.
if (process.env.STORAGE_CREATE_BUCKET === 'on') await storage.ensureBucket()
// Sign-in with WorkOS (#58) when its settings are given; the development session only when asked for.
const workos = workosSettings()
const dev = process.env.DAZBEE_DEV_SESSION === 'on'
if (dev && process.env.NODE_ENV === 'production') throw new Error('DAZBEE_DEV_SESSION is never on in production')
const signIn = workos ? { provider: workosProvider(workos), secret: sessionSecret() } : null

const { db, close } = openDatabase(databaseUrl)
await migrateDatabase(db)
if (dev) await seedDevelopment(db)

// The development session reads session tokens too when it has a secret, so a check in the browser can sign in as a Reviewer.
const tokenSecret = signIn?.secret ?? (dev && process.env.SESSION_SECRET ? sessionSecret() : null)
const sessionOf = sessionOfRequest({ secret: tokenSecret, dev })
// Invites go through WorkOS for a workspace with an organization. The development stand-in serves one
// without, such as the development workspace, when the development session is on and tokens can be
// signed; its links open the web app at WEB_URL, else on its local port.
const invites = {
  workos: workos ? workosInvites(workos) : null,
  dev:
    dev && tokenSecret
      ? { provider: devInvites(db, process.env.WEB_URL ?? 'http://localhost:3000'), secret: tokenSecret }
      : null,
}
// The image sets BUILD_ID to the commit it was built from; a server run from a checkout is `dev`.
const build = process.env.BUILD_ID || 'dev'
const app = createApp({ db, storage, sessionOf, syncSecret, build, signIn, invites })
const ways =
  [signIn && 'WorkOS sign-in', dev && 'the development session'].filter(Boolean).join(' and ') || 'no way to sign in'
const server = serve({ fetch: app.fetch, port }, () => console.log(`api on http://localhost:${port} with ${ways}`))

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => void close()))
}
