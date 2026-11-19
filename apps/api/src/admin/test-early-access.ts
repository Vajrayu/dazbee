// Early access as the admin tests see it: an app with an admin and no allow-list beside the tests' own app,
// the WorkOS stand-in's people who sign in to it, and asking it as one of them.
import { randomUUID } from 'node:crypto'

import type { Hono } from 'hono'

import { CreateDazbeeInvite, DazbeeInvite, SignedIn } from '@dazbee/schema'
import { signSessionToken } from '@dazbee/session-token'

import { createApp } from '../app.ts'
import type { Env } from '../http.ts'
import { tokenSession } from '../sign-in/session.ts'
import type { SignedInPerson } from '../sign-in/sign-in.ts'
import { addPerson, addWorkspace, db, run, sessionSecret, storage, syncSecret, workos } from '../test-api.ts'
import type { TurnstileCheck } from './turnstile.ts'
import { requestLimit } from './waiting-list.ts'

/** A session token for the person. */
export const tokenOf = (userId: string) => signSessionToken(sessionSecret, { userId, workosSessionId: null }).token

/** The admins of every app `earlyApp` makes; `addAdmin` adds one. */
export const admins = new Set<string>()

/** An app in early access with `admins`, and the Turnstile check given. */
export function earlyApp({ turnstile = null }: { turnstile?: TurnstileCheck | null } = {}) {
  return createApp({
    db,
    storage,
    sessionOf: tokenSession(sessionSecret),
    syncSecret,
    build: 'test-build',
    signIn: { provider: workos.provider, secret: sessionSecret, admins },
    invites: { workos: workos.invites, dev: null },
    admins,
    requests: requestLimit(),
    turnstile,
  })
}

/** The app the admin tests ask unless told another. */
export const app = earlyApp()

/** Makes a person who is an admin, the Owner of a workspace of their own, with their session token. */
export async function addAdmin() {
  const own = await addWorkspace('Admin’s')
  const person = await addPerson([[own.id, 'owner']])
  admins.add(person.email)
  return { ...person, token: tokenOf(person.id) }
}

let people = 0
/** A person WorkOS knows, with a verified email, and a code that signs them in. */
export function newPerson(email = `invited-${(people += 1)}-${run}@example.com`) {
  const person: SignedInPerson = {
    user: { id: `user_invited_${randomUUID()}`, email, name: `Invited ${people}`, emailVerified: true },
    sessionId: `session_invited_${randomUUID()}`,
  }
  const code = `code-invited-${randomUUID()}`
  workos.people[code] = person
  return { person, code }
}

/** Asks `on` at `path` with the session token given, or none: the answer's status and body. */
export async function ask(token: string | null, method: string, path: string, body?: unknown, on: Hono<Env> = app) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  const response = await on.request(path, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: response.status, json: response.status === 204 ? null : ((await response.json()) as unknown) }
}

/** Signs in with the code: the answer's status, and the session when it let them in. */
export async function signIn(code: string) {
  const answer = await ask(null, 'POST', '/auth/callback', { code })
  return {
    status: answer.status,
    json: answer.json,
    session: answer.status === 200 ? SignedIn.parse(answer.json) : null,
  }
}

/** Invites the email as the admin: the invite, and the WorkOS invitation it sent. */
export async function inviteAs(token: string, email: string) {
  const sent = await ask(token, 'POST', '/admin/invites', CreateDazbeeInvite.parse({ email }))
  if (sent.status !== 201) throw new Error(`Inviting answered ${sent.status}: ${JSON.stringify(sent.json)}`)
  const invitation = workos.made.invitations.at(-1)
  if (!invitation) throw new Error('no invitation sent')
  return { invite: DazbeeInvite.parse(sent.json), invitationId: invitation.id }
}
