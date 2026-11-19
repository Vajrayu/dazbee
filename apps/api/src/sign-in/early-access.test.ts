// Early access at sign-in, against Postgres from Docker Compose, with the WorkOS stand-in: an app with an
// allow-list beside the tests' own, which has none. A refused person leaves no row of theirs behind.
import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'

import { invites, memberships, users, workspaces } from '@dazbee/db'
import { Invite, SignedIn, SignInRefused } from '@dazbee/schema'

import { createApp } from '../app.ts'
import {
  addPerson,
  app as openApp,
  call,
  db,
  run,
  sessionSecret,
  storage,
  syncSecret,
  workos,
  workspace,
} from '../test-api.ts'
import { allowList } from './early-access.ts'
import { tokenSession } from './session.ts'
import type { SignedInPerson } from './sign-in.ts'

/** The emails on the list, one in upper case and with spaces around it, as an owner might type them. */
const listed = `listed-${run}@example.com`
const allowed = allowList({ ALLOWED_EMAILS: ` ${listed.toUpperCase()} , other-${run}@example.com,` })
const earlyApp = createApp({
  db,
  storage,
  sessionOf: tokenSession(sessionSecret),
  syncSecret,
  build: 'test-build',
  signIn: { provider: workos.provider, secret: sessionSecret, allowed },
  invites: { workos: workos.invites, dev: null },
})

let people = 0
/** A person WorkOS knows, named after their email, with a code that signs them in. */
function newPerson(email = `early-${(people += 1)}-${run}@example.com`, emailVerified = true) {
  const person: SignedInPerson = {
    user: { id: `user_early_${randomUUID()}`, email, name: `Early ${email}`, emailVerified },
    sessionId: `session_early_${randomUUID()}`,
  }
  const code = `code-early-${randomUUID()}`
  workos.people[code] = person
  return { person, code }
}

/** Signs in with the code at `app`: the answer's status and body. */
async function signIn(code: string, app = earlyApp) {
  const response = await app.request('/auth/callback', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code }),
  })
  return { status: response.status, json: (await response.json()) as unknown }
}

/** What is recorded of the person: their user, memberships, and a workspace named after them. */
async function recordsOf(person: SignedInPerson) {
  return {
    users: await db.select({ id: users.id }).from(users).where(eq(users.workosUserId, person.user.id)),
    memberships: await db
      .select({ workspaceId: memberships.workspaceId, role: memberships.role })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(users.workosUserId, person.user.id)),
    workspaces: await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.name, person.user.name)),
  }
}

/**
 * Expects the person refused for `reason`, with nothing recorded of them, no WorkOS organization made, their
 * WorkOS session ended, and the refusal logged with its reason and not their email.
 */
async function expectRefused(code: string, person: SignedInPerson, reason: SignInRefused['reason']) {
  const organizations = workos.made.organizations.length
  const logged: string[] = []
  const log = vi.spyOn(console, 'log').mockImplementation((line: string) => void logged.push(line))
  onTestFinished(() => log.mockRestore())
  const answer = await signIn(code)
  expect(answer.status).toBe(403)
  expect(SignInRefused.parse(answer.json).reason).toBe(reason)
  expect(logged).toContain(JSON.stringify({ event: 'sign-in-refused', reason }))
  expect(logged.join(' ')).not.toContain(person.user.email)
  expect(await recordsOf(person)).toEqual({ users: [], memberships: [], workspaces: [] })
  expect(workos.made.organizations).toHaveLength(organizations)
  expect(workos.made.endedSessions).toContain(person.sessionId)
}

/** Invites the email to workspace A as its Owner; the WorkOS invitation it sent. */
async function invite(email: string) {
  const sent = await call('a', 'POST', '/invites', { email, role: 'editor' })
  expect(sent.status).toBe(201)
  const invitation = workos.made.invitations.at(-1)
  if (!invitation) throw new Error('no invitation sent')
  return { invite: Invite.parse(sent.json), invitationId: invitation.id }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('early access at sign-in', () => {
  it('lets in a person whose verified email is on the list, making their workspace', async () => {
    const { person, code } = newPerson(listed)
    const answer = await signIn(code)
    expect(answer.status).toBe(200)
    const { open } = SignedIn.parse(answer.json)
    expect(await recordsOf(person)).toMatchObject({
      memberships: [{ workspaceId: open, role: 'owner' }],
      workspaces: [{ id: open }],
    })
  })

  it('refuses a person whose email is on the list but not verified', async () => {
    const { person, code } = newPerson(`other-${run}@example.com`, false)
    await expectRefused(code, person, 'early-access')
  })

  it('lets in a person who already has a membership, though not on the list', async () => {
    const member = await addPerson([[workspace.id, 'editor']])
    const person: SignedInPerson = {
      user: { id: member.workosUserId, email: member.email, name: member.name, emailVerified: false },
      sessionId: null,
    }
    const code = `code-member-${randomUUID()}`
    workos.people[code] = person
    const answer = await signIn(code)
    expect(answer.status).toBe(200)
    expect(SignedIn.parse(answer.json).open).toBe(workspace.id)
  })

  it('lets in a person whose sign-in accepts an invite, making them a member and no workspace of their own', async () => {
    const { person, code } = newPerson()
    const { invitationId } = await invite(person.user.email)
    workos.accept(invitationId, person.user.id)
    const answer = await signIn(code)
    expect(answer.status).toBe(200)
    expect(SignedIn.parse(answer.json).open).toBe(workspace.id)
    expect(await recordsOf(person)).toMatchObject({
      memberships: [{ workspaceId: workspace.id, role: 'editor' }],
      workspaces: [],
    })
  })

  it('tells a person with a pending invite they did not sign in through to open it', async () => {
    const { person, code } = newPerson()
    await invite(person.user.email)
    await expectRefused(code, person, 'open-invite')
  })

  it('tells a person to open an invite only when their email is verified and the invite still pending', async () => {
    const unverified = newPerson(undefined, false)
    await invite(unverified.person.user.email)
    await expectRefused(unverified.code, unverified.person, 'early-access')

    const revoked = newPerson()
    const { invitationId } = await invite(revoked.person.user.email)
    // Revoked with WorkOS, though still pending here.
    await workos.invites.revoke(invitationId)
    await expectRefused(revoked.code, revoked.person, 'early-access')
  })

  it('refuses anyone else', async () => {
    const { person, code } = newPerson()
    await expectRefused(code, person, 'early-access')
  })

  it('refuses a person whose accepted invite was revoked while they signed in, undoing their record', async () => {
    const { person, code } = newPerson()
    const { invite: sent, invitationId } = await invite(person.user.email)
    workos.accept(invitationId, person.user.id)
    // The invite is revoked here once WorkOS has said it was accepted, before it is accepted here.
    const read = workos.invites.read.bind(workos.invites)
    vi.spyOn(workos.invites, 'read').mockImplementationOnce(async (id) => {
      const held = await read(id)
      await db.update(invites).set({ revokedAt: new Date() }).where(eq(invites.id, sent.id))
      return held
    })
    await expectRefused(code, person, 'early-access')
  })

  it('makes no workspace for a member removed while they signed in', async () => {
    const member = await addPerson([[workspace.id, 'editor']])
    const person: SignedInPerson = {
      user: { id: member.workosUserId, email: member.email, name: member.name, emailVerified: true },
      sessionId: `session_member_${randomUUID()}`,
    }
    const code = `code-member-${randomUUID()}`
    workos.people[code] = person
    // The membership is removed once early access has let them in, before they are recorded.
    const transaction = db.transaction.bind(db)
    vi.spyOn(db, 'transaction').mockImplementationOnce(async (...args) => {
      await db.delete(memberships).where(eq(memberships.userId, member.id))
      return transaction(...args)
    })
    const organizations = workos.made.organizations.length
    const answer = await signIn(code)
    expect(answer.status).toBe(403)
    expect(SignInRefused.parse(answer.json).reason).toBe('early-access')
    expect(await recordsOf(person)).toMatchObject({ memberships: [], workspaces: [] })
    expect(workos.made.organizations).toHaveLength(organizations)
  })

  it('asks a refused person to try again while an invite of theirs can’t be read, recording nothing', async () => {
    const { person, code } = newPerson()
    await invite(person.user.email)
    vi.spyOn(workos.invites, 'read').mockRejectedValueOnce(new Error('WorkOS is down'))
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const answer = await signIn(code)
    expect(answer.status).toBe(503)
    expect(await recordsOf(person)).toEqual({ users: [], memberships: [], workspaces: [] })
    expect(workos.made.endedSessions).not.toContain(person.sessionId)
  })

  it('lets anyone in when the list is empty', async () => {
    const { person, code } = newPerson(`stranger-${run}@example.com`, false)
    const answer = await signIn(code, openApp)
    expect(answer.status).toBe(200)
    expect(await recordsOf(person)).toMatchObject({ memberships: [{ role: 'owner' }] })
  })
})

describe('allowList', () => {
  it('reads comma-separated emails in lower case, and no list from an empty setting', () => {
    expect(allowList({ ALLOWED_EMAILS: ' Ann@Example.com,bo@example.com ,' })).toEqual(
      new Set(['ann@example.com', 'bo@example.com']),
    )
    expect(allowList({ ALLOWED_EMAILS: ' , ' })).toBeNull()
    expect(allowList({ ALLOWED_EMAILS: '' })).toBeNull()
    expect(allowList({})).toBeNull()
  })
})
