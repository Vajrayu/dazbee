// The development stand-in for invites and its accept route, against Postgres from Docker Compose
// (`docker compose up -d --wait postgres`), on a workspace with no WorkOS organization.
import { and, eq } from 'drizzle-orm'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { memberships, users, workspaces } from '@dazbee/db'
import { Invite, SignedIn, WorkspaceMember } from '@dazbee/schema'

import { createApp } from '../app.ts'
import { db, request as askTestApp, run, sessionSecret, storage, syncSecret, workos, workspace } from '../test-api.ts'
import { devInvites } from './dev-invites.ts'
import { readSessionToken, signSessionToken, tokenSession } from './session.ts'

const WEB_URL = 'http://localhost:3100'
const devWorkspace = { id: `dev-invites-${run}`, name: 'Development invites' }
const owner = { id: `dev-owner-${run}`, workosUserId: `dev-owner-${run}`, email: `dev-owner-${run}@example.com` }
const ownerToken = signSessionToken(sessionSecret, { userId: owner.id, workosSessionId: null }).token

const dev = devInvites(db, WEB_URL)
const app = createApp({
  db,
  storage,
  sessionOf: tokenSession(sessionSecret),
  syncSecret,
  invites: { workos: null, dev: { provider: dev, secret: sessionSecret } },
})

async function ask(method: string, path: string, { body, token }: { body?: unknown; token?: string } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  const response = await app.request(path, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: response.status, json: response.status === 204 ? null : ((await response.json()) as unknown) }
}

let emails = 0
/** Invites a new email to the development workspace as its Owner; the id its link names. */
async function invite(role: string) {
  const email = `dev-invitee-${(emails += 1)}-${run}@example.com`
  const sent = await ask('POST', `/workspaces/${devWorkspace.id}/invites`, {
    body: { email, role },
    token: ownerToken,
  })
  expect(sent.status).toBe(201)
  const invite = Invite.parse(sent.json)
  const linked = new URL(invite.link)
  expect(`${linked.origin}${linked.pathname}`).toBe(`${WEB_URL}/dev/accept`)
  return { email, invite, linkId: linked.searchParams.get('invite') ?? '' }
}

/** The person's role in the development workspace, read back from the database. */
const roleOf = (userId: string) =>
  db
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.workspaceId, devWorkspace.id)))

const accept = (linkId: string) => ask('POST', '/auth/dev/accept', { body: { invite: linkId } })

beforeAll(async () => {
  await db.insert(workspaces).values(devWorkspace)
  await db.insert(users).values(owner)
  await db.insert(memberships).values({ workspaceId: devWorkspace.id, userId: owner.id, role: 'owner' })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('accepting a development invite', () => {
  it('signs in a new person with the invite’s email, a member with its role, in the invited workspace', async () => {
    const { email, linkId } = await invite('editor')
    const accepted = await accept(linkId)
    expect(accepted.status).toBe(200)
    const signedIn = SignedIn.parse(accepted.json)
    expect(signedIn.open).toBe(devWorkspace.id)

    const [person] = await db
      .select()
      .from(users)
      .where(eq(users.workosUserId, `dev:${email}`))
    expect(person).toMatchObject({ email })
    expect(
      await db
        .select({ workspaceId: memberships.workspaceId, role: memberships.role })
        .from(memberships)
        .where(eq(memberships.userId, person?.id ?? '')),
    ).toEqual([{ workspaceId: devWorkspace.id, role: 'editor' }])
    const members = WorkspaceMember.array().parse(
      (await ask('GET', `/workspaces/${devWorkspace.id}/members`, { token: signedIn.token })).json,
    )
    expect(members.map((m) => [m.email, m.role])).toEqual([
      [owner.email, 'owner'],
      [email, 'editor'],
    ])
    // A used link is refused.
    expect(await accept(linkId)).toEqual({
      status: 400,
      json: { error: 'This invite has expired, was revoked or was already used' },
    })
  })

  it('makes no member from a revoked invite', async () => {
    const { email, invite: sent, linkId } = await invite('reviewer')
    const path = `/workspaces/${devWorkspace.id}/invites/${sent.id}`
    expect((await ask('DELETE', path, { token: ownerToken })).status).toBe(204)
    expect((await accept(linkId)).status).toBe(400)
    expect(
      await db
        .select()
        .from(users)
        .where(eq(users.workosUserId, `dev:${email}`)),
    ).toEqual([])
  })

  it('finds no invite of a workspace with a WorkOS organization, nor one it never sent', async () => {
    expect((await accept('nothing-sent')).status).toBe(404)
    const email = `workos-invitee-${run}@example.com`
    const sent = await askTestApp('a', 'POST', `/workspaces/${workspace.id}/invites`, { email, role: 'editor' })
    expect(sent.status).toBe(201)
    const invitation = workos.made.invitations.at(-1)
    expect(invitation?.email).toBe(email)
    expect(await accept(invitation?.id ?? '')).toEqual({ status: 404, json: { error: 'No such invite' } })
    expect(
      await db
        .select()
        .from(users)
        .where(eq(users.workosUserId, `dev:${email}`)),
    ).toEqual([])
  })

  it('accepts as the development person of the email when there is one, making no second', async () => {
    const { email, linkId } = await invite('reviewer')
    const known = { id: `known-dev-${run}`, workosUserId: `dev:${email}`, email }
    await db.insert(users).values(known)
    const signedIn = SignedIn.parse((await accept(linkId)).json)
    expect(readSessionToken(sessionSecret, signedIn.token)?.userId).toBe(known.id)
    expect(await db.select({ id: users.id }).from(users).where(eq(users.workosUserId, known.workosUserId))).toEqual([
      { id: known.id },
    ])
    expect(await roleOf(known.id)).toEqual([{ role: 'reviewer' }])
  })

  it('never signs in a WorkOS account with the email, making the development person instead', async () => {
    const { email, linkId } = await invite('editor')
    const account = { id: `account-${run}`, workosUserId: `user_account_${run}`, email }
    await db.insert(users).values(account)
    const signedIn = SignedIn.parse((await accept(linkId)).json)
    const [person] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.workosUserId, `dev:${email}`))
    expect(person).toBeDefined()
    expect(readSessionToken(sessionSecret, signedIn.token)?.userId).toBe(person?.id)
    expect(await roleOf(person?.id ?? '')).toEqual([{ role: 'editor' }])
    expect(await roleOf(account.id)).toEqual([])
  })

  it('leaves no one behind, and the stand-in forgetting the accept, when accepting makes no membership', async () => {
    const { email, linkId } = await invite('editor')
    // The stand-in says pending at the route's check, then not accepted when accepting asks.
    const read = dev.read.bind(dev)
    let reads = 0
    vi.spyOn(dev, 'read').mockImplementation(async (id) => {
      reads += 1
      const held = await read(id)
      return reads === 2 ? { ...held, state: 'pending', acceptedUserId: null } : held
    })
    expect((await accept(linkId)).status).toBe(400)
    expect(
      await db
        .select()
        .from(users)
        .where(eq(users.workosUserId, `dev:${email}`)),
    ).toEqual([])
    expect((await dev.read(linkId)).state).toBe('pending')
  })

  it('is not found when the development session is off', async () => {
    const { linkId } = await invite('editor')
    expect(await askTestApp(null, 'POST', '/auth/dev/accept', { invite: linkId })).toEqual({
      status: 404,
      json: { error: 'Not found' },
    })
  })
})
