// Changing a member's role, removing a member, handing over Owner and leaving, against Postgres from
// Docker Compose (`docker compose up -d --wait postgres`), with the WorkOS stand-in.
import { and, eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { memberships } from '@dazbee/db'
import { ApiError, BrandSummary, DesignSummary, Me, type MemberRole, SyncToken, WorkspaceMember } from '@dazbee/schema'
import { verifySyncToken } from '@dazbee/sync-token'

import { addPerson, addWorkspace, call, db, organizationOf, request, syncSecret, workos } from '../test-api.ts'

type Team = Awaited<ReturnType<typeof team>>

/** A member of a team by who they are to the one asking; `self` is the one asking. */
type Who = MemberRole | 'self'

/** A change asked as `as` onto `target`, a member of the team `t`. */
type Change = (
  t: Team,
  as: string,
  target: { id: string; role: MemberRole },
) => Promise<{ status: number; json: unknown }>

const ROLES = ['owner', 'admin', 'editor', 'reviewer'] as const
const WHO = [...ROLES, 'self'] as const

/** A workspace of its own with an Owner, two Admins, an Editor and a Reviewer. */
async function team() {
  const { id } = await addWorkspace()
  const add = (role: MemberRole) => addPerson([[id, role]])
  return {
    id,
    owner: await add('owner'),
    admin: await add('admin'),
    admin2: await add('admin'),
    editor: await add('editor'),
    reviewer: await add('reviewer'),
  }
}

/** The member of `t` that `target` names to `actor`: the other Admin when both are Admins. */
function memberNamed(t: Team, actor: MemberRole, target: Who) {
  if (target === 'self') return t[actor]
  return actor === 'admin' && target === 'admin' ? t.admin2 : t[target]
}

/** How many Owners the workspace has, as the database holds them. */
async function owners(workspaceId: string) {
  const rows = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.role, 'owner')))
  return rows.length
}

/**
 * Asks `change` as each role, each in a team of its own, onto each member, and gives each answer's
 * status and error, checking that the workspace has exactly one Owner after each.
 */
async function eachChange(change: Change) {
  const answers: [MemberRole, Who, number, string][] = []
  for (const actor of ROLES)
    for (const target of WHO) {
      const t = await team()
      const member = memberNamed(t, actor, target)
      const answer = await change(t, t[actor].as, { id: member.id, role: target === 'self' ? actor : target })
      answers.push([actor, target, answer.status, answer.status < 300 ? '' : ApiError.parse(answer.json).error])
      expect(await owners(t.id)).toBe(1)
    }
  return answers
}

/** The workspace's members, as its members list gives them to `as`. */
const membersOf = async (as: string) => WorkspaceMember.array().parse((await call(as, 'GET', '/members')).json)

const NOT_MANAGER = [403, 'Only an Owner or Admin can do this'] as const
const DONE = [200, ''] as const

afterEach(() => {
  vi.restoreAllMocks()
})

describe('changing a role', () => {
  it('lets the Owner change an Editor to a Reviewer', async () => {
    const { owner, editor } = await team()
    const changed = await call(owner.as, 'PATCH', `/members/${editor.id}`, { role: 'reviewer' })
    expect(changed.status).toBe(200)
    expect(WorkspaceMember.parse(changed.json)).toMatchObject({ id: editor.id, role: 'reviewer' })
    expect((await membersOf(owner.as)).find((m) => m.id === editor.id)?.role).toBe('reviewer')
  })

  it('lets an Owner or Admin change any role but the Owner’s and their own, and no one else change any', async () => {
    const answers = await eachChange((_t, as, target) =>
      call(as, 'PATCH', `/members/${target.id}`, { role: target.role === 'reviewer' ? 'editor' : 'reviewer' }),
    )
    const owner = [403, 'The Owner’s role is changed only by handing over Owner'] as const
    const self = [403, 'You can’t change your own role'] as const
    expect(answers).toEqual([
      ['owner', 'owner', ...self],
      ['owner', 'admin', ...DONE],
      ['owner', 'editor', ...DONE],
      ['owner', 'reviewer', ...DONE],
      ['owner', 'self', ...self],
      ['admin', 'owner', ...owner],
      ['admin', 'admin', ...DONE],
      ['admin', 'editor', ...DONE],
      ['admin', 'reviewer', ...DONE],
      ['admin', 'self', ...self],
      ...(['editor', 'reviewer'] as const).flatMap((actor) => WHO.map((target) => [actor, target, ...NOT_MANAGER])),
    ])
  })

  it('refuses a member moved down to Reviewer their next design change, and signs their next sync token as a Reviewer’s', async () => {
    const { owner, editor } = await team()
    const brandOf = BrandSummary.parse((await call(owner.as, 'POST', '/brands', { name: 'Kept' })).json)
    const designs = `/brands/${brandOf.id}/designs`
    const design = DesignSummary.parse((await call(editor.as, 'POST', designs, { name: 'Draft' })).json)
    expect((await call(editor.as, 'PATCH', `${designs}/${design.id}`, { name: 'Draft 2' })).status).toBe(200)
    expect((await call(owner.as, 'PATCH', `/members/${editor.id}`, { role: 'reviewer' })).status).toBe(200)
    expect(await call(editor.as, 'PATCH', `${designs}/${design.id}`, { name: 'Draft 3' })).toEqual({
      status: 403,
      json: { error: 'Only an Owner, Admin or Editor can do this' },
    })
    const { token } = SyncToken.parse((await call(editor.as, 'POST', `${designs}/${design.id}/sync-token`)).json)
    expect(verifySyncToken(syncSecret, token, design.id)).toMatchObject({ ok: true, payload: { role: 'reviewer' } })
  })

  it('makes no Owner, and finds no member of another workspace', async () => {
    const { owner, admin } = await team()
    const asOwner = await call(owner.as, 'PATCH', `/members/${admin.id}`, { role: 'owner' })
    expect(asOwner.status).toBe(400)
    expect(ApiError.parse(asOwner.json).error).toMatch(/Admin, Editor or Reviewer/)
    const elsewhere = await team()
    expect(await call(owner.as, 'PATCH', `/members/${elsewhere.editor.id}`, { role: 'reviewer' })).toEqual({
      status: 404,
      json: { error: 'No such member' },
    })
    expect((await membersOf(elsewhere.owner.as)).find((m) => m.id === elsewhere.editor.id)?.role).toBe('editor')
  })
})

describe('removing a member', () => {
  it('lets an Owner or Admin remove anyone but the Owner and themselves, and no one else remove anyone', async () => {
    const answers = await eachChange((_t, as, target) => call(as, 'DELETE', `/members/${target.id}`))
    const owner = [403, 'The Owner can’t be removed'] as const
    const self = [403, 'Leave the workspace to stop being its member'] as const
    const removed = [204, ''] as const
    expect(answers).toEqual([
      ['owner', 'owner', ...self],
      ['owner', 'admin', ...removed],
      ['owner', 'editor', ...removed],
      ['owner', 'reviewer', ...removed],
      ['owner', 'self', ...self],
      ['admin', 'owner', ...owner],
      ['admin', 'admin', ...removed],
      ['admin', 'editor', ...removed],
      ['admin', 'reviewer', ...removed],
      ['admin', 'self', ...self],
      ...(['editor', 'reviewer'] as const).flatMap((actor) => WHO.map((target) => [actor, target, ...NOT_MANAGER])),
    ])
  })

  it('answers the removed member’s next request 404, takes them out of the WorkOS organization, and lets their email be invited again', async () => {
    const { id, owner, editor } = await team()
    expect((await call(editor.as, 'GET', '/members')).status).toBe(200)
    expect(await call(owner.as, 'DELETE', `/members/${editor.id}`)).toEqual({ status: 204, json: null })
    expect(await call(editor.as, 'GET', '/members')).toEqual({ status: 404, json: { error: 'No such workspace' } })
    expect(workos.made.removed).toContainEqual({ organizationId: organizationOf(id), userId: editor.workosUserId })
    expect((await membersOf(owner.as)).map((m) => m.id)).not.toContain(editor.id)
    const again = await call(owner.as, 'POST', '/invites', { email: editor.email, role: 'editor' })
    expect(again.status).toBe(201)
  })

  it('removes nothing when WorkOS can’t take the member out, so trying again works', async () => {
    const { owner, editor } = await team()
    vi.spyOn(workos.invites, 'removeMember').mockRejectedValueOnce(new Error('WorkOS is down'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await call(owner.as, 'DELETE', `/members/${editor.id}`)).status).toBe(500)
    expect((await membersOf(owner.as)).map((m) => m.id)).toContain(editor.id)
    expect((await call(owner.as, 'DELETE', `/members/${editor.id}`)).status).toBe(204)
  })

  it('removes a member once when the Owner and an Admin remove them at once, answering the other 404', async () => {
    const { id, owner, admin, editor } = await team()
    const removing = workos.invites.removeMember.bind(workos.invites)
    // WorkOS answers slowly, so the second removal asks while the first waits on it.
    vi.spyOn(workos.invites, 'removeMember').mockImplementation(async (...args) => {
      await new Promise((resolve) => setTimeout(resolve, 100))
      return removing(...args)
    })
    const both = await Promise.all([
      call(owner.as, 'DELETE', `/members/${editor.id}`),
      call(admin.as, 'DELETE', `/members/${editor.id}`),
    ])
    expect(both.map((answer) => answer.status).sort()).toEqual([204, 404])
    const out = { organizationId: organizationOf(id), userId: editor.workosUserId }
    expect(
      workos.made.removed.filter((r) => r.organizationId === out.organizationId && r.userId === out.userId),
    ).toEqual([out])
  })
})

describe('handing over Owner', () => {
  it('lets only the Owner hand Owner to an Admin', async () => {
    const answers = await eachChange((_t, as, target) => call(as, 'POST', `/members/${target.id}/owner`))
    const notOwner = [403, 'Only the Owner can hand over Owner'] as const
    const notAdmin = [400, 'Only an Admin can be made Owner'] as const
    expect(answers).toEqual([
      ['owner', 'owner', ...notAdmin],
      ['owner', 'admin', 204, ''],
      ['owner', 'editor', ...notAdmin],
      ['owner', 'reviewer', ...notAdmin],
      ['owner', 'self', ...notAdmin],
      ...(['admin', 'editor', 'reviewer'] as const).flatMap((actor) =>
        WHO.map((target) => [actor, target, ...notOwner]),
      ),
    ])
  })

  it('makes the Admin the Owner and the Owner an Admin, who then manages as one', async () => {
    const { owner, admin, editor } = await team()
    expect(await call(owner.as, 'POST', `/members/${admin.id}/owner`)).toEqual({ status: 204, json: null })
    const roles = new Map((await membersOf(owner.as)).map((m) => [m.id, m.role]))
    expect([roles.get(admin.id), roles.get(owner.id)]).toEqual(['owner', 'admin'])
    expect((await call(owner.as, 'POST', `/members/${admin.id}/owner`)).status).toBe(403)
    expect((await call(owner.as, 'PATCH', `/members/${editor.id}`, { role: 'reviewer' })).status).toBe(200)
    expect((await call(owner.as, 'DELETE', `/members/${admin.id}`)).status).toBe(403)
  })

  it('finds no member to hand Owner to once they are gone', async () => {
    const { owner, admin } = await team()
    expect((await call(owner.as, 'DELETE', `/members/${admin.id}`)).status).toBe(204)
    expect(await call(owner.as, 'POST', `/members/${admin.id}/owner`)).toEqual({
      status: 404,
      json: { error: 'No such member' },
    })
  })

  it('can’t be done by a write that makes a second Owner: the database refuses it', async () => {
    const { id, admin } = await team()
    const promote = db
      .update(memberships)
      .set({ role: 'owner' })
      .where(and(eq(memberships.workspaceId, id), eq(memberships.userId, admin.id)))
    await expect(promote).rejects.toThrow()
    expect(await owners(id)).toBe(1)
  })

  it('leaves exactly one Owner when the Owner hands over to two Admins at once', async () => {
    const t = await team()
    const both = await Promise.all([
      call(t.owner.as, 'POST', `/members/${t.admin.id}/owner`),
      call(t.owner.as, 'POST', `/members/${t.admin2.id}/owner`),
    ])
    expect(both.map((answer) => answer.status).sort()).toEqual([204, 403])
    expect(await owners(t.id)).toBe(1)
  })
})

describe('leaving', () => {
  it('lets anyone but the Owner leave, out of the WorkOS organization too, and answers their next request 404', async () => {
    const answers: [MemberRole, number, unknown][] = []
    for (const role of ROLES) {
      const t = await team()
      const leaving = t[role]
      const left = await call(leaving.as, 'POST', '/leave')
      answers.push([role, left.status, left.json])
      expect(await owners(t.id)).toBe(1)
      if (left.status !== 204) continue
      expect((await call(leaving.as, 'GET', '/members')).status).toBe(404)
      expect((await membersOf(t.owner.as)).map((m) => m.id)).not.toContain(leaving.id)
      expect(workos.made.removed).toContainEqual({ organizationId: organizationOf(t.id), userId: leaving.workosUserId })
    }
    expect(answers).toEqual([
      ['owner', 400, { error: 'Hand over Owner first' }],
      ['admin', 204, null],
      ['editor', 204, null],
      ['reviewer', 204, null],
    ])
  })

  it('opens the workspace used last of those left, and none once the last is left', async () => {
    const [a, b] = [await team(), await team()]
    const person = await addPerson([
      [a.id, 'editor'],
      [b.id, 'reviewer'],
    ])
    const open = async () => Me.parse((await request(person.as, 'GET', '/me')).json).open
    for (const visit of [b.id, a.id]) {
      expect((await call({ as: person.as, workspace: visit }, 'GET', '')).status).toBe(200)
    }
    expect(await open()).toBe(a.id)
    expect((await call({ as: person.as, workspace: a.id }, 'POST', '/leave')).status).toBe(204)
    expect(await open()).toBe(b.id)
    expect((await call({ as: person.as, workspace: b.id }, 'POST', '/leave')).status).toBe(204)
    expect(await open()).toBeNull()
  })
})
