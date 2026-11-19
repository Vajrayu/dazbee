// The sign-in routes: the WorkOS link, the callback that makes a session, and signing out. None needs a session.
import { Hono } from 'hono'

import type { Db } from '@dazbee/db'
import {
  CompleteSignIn,
  InvitationToken,
  type SignedIn,
  type SignedOut,
  type SignInLink,
  type SignInRefused,
} from '@dazbee/schema'

import { body, type Env, error } from '../http.ts'
import type { InvitesProviders } from '../members/invites-provider.ts'
import { EarlyAccessRefused, endRefusedSession } from './early-access.ts'
import { bearerToken, readSessionToken } from './session.ts'
import { completeSignIn, type SignedInPerson, type SignInSettings, SignInUnfinished } from './sign-in.ts'

export function signInRoutes({
  db,
  signIn,
  invites,
}: {
  db: Db
  signIn: SignInSettings | null
  invites: InvitesProviders
}): Hono<Env> {
  const app = new Hono<Env>()

  // Sign-in. The web app's /login asks for the link, carrying the token of an invite the person came
  // from, and its /callback hands back the code.
  app.get('/auth/sign-in-url', (c) => {
    if (!signIn) return c.json(error('Sign-in is not set up'), 404)
    const state = c.req.query('state') ?? ''
    if (!/^[\w-]{16,128}$/.test(state)) return c.json(error('state: 16–128 letters, digits, _ and -'), 400)
    const invitationToken = InvitationToken.optional().safeParse(c.req.query('invitationToken'))
    if (!invitationToken.success)
      return c.json(error(invitationToken.error.issues.map((i) => i.message).join('; ')), 400)
    return c.json({ url: signIn.provider.signInUrl(state, invitationToken.data) } satisfies SignInLink)
  })

  app.post('/auth/callback', async (c) => {
    if (!signIn) return c.json(error('Sign-in is not set up'), 404)
    const input = await body(c.req.raw, CompleteSignIn)
    if (input instanceof Response) return input
    let person: SignedInPerson
    try {
      person = await signIn.provider.authenticate(input.code)
    } catch {
      return c.json(error('That sign-in did not work; try again'), 400)
    }
    try {
      return c.json((await completeSignIn(db, signIn, invites, person)) satisfies SignedIn)
    } catch (e) {
      if (e instanceof SignInUnfinished) return c.json(error(e.message), 503)
      if (e instanceof EarlyAccessRefused) {
        await endRefusedSession(signIn.provider, person)
        return c.json({ ...error(e.message), reason: e.reason } satisfies SignInRefused, 403)
      }
      throw e
    }
  })

  // Signing out forgets the token in the web app; this says where to end the WorkOS session too.
  app.post('/auth/sign-out', (c) => {
    const token = bearerToken(c.req.raw)
    const payload = signIn && token ? readSessionToken(signIn.secret, token) : null
    const logoutUrl = payload?.workosSessionId ? (signIn?.provider.signOutUrl(payload.workosSessionId) ?? null) : null
    return c.json({ logoutUrl } satisfies SignedOut)
  })

  return app
}
