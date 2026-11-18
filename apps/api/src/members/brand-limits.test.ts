// Limiting an Editor or Reviewer to some brands, through their invite or later, against Postgres from
// Docker Compose (`docker compose up -d --wait postgres`), with the WorkOS stand-in sending the invites.
import { randomUUID } from 'node:crypto'

import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { brands, memberships } from '@dazbee/db'
import { BrandSummary, DesignSummary, Invite, SignedIn, TemplateSummary, WorkspaceMember } from '@dazbee/schema'

import { addPerson, app, brand, call, db, otherBrand, request, run, sibling, workos, workspace } from '../test-api.ts'

/** One page holding one empty, white frame. */
const blank = {
  meta: { designId: 'any', name: 'Plain' },
  pages: { p1: { name: 'Page 1', order: 'a0' } },
  frames: {
    sq: {
      pageId: 'p1',
      name: 'Square',
      width: 200,
      height: 200,
      x: 0,
      y: 0,
      fills: [{ type: 'solid', color: '#FFFFFFFF' }],
      order: 'a0',
    },
  },
  nodes: {},
}

let people = 0
/** A person WorkOS can sign in, who is no member of anything yet, and how they sign in. */
function newPerson() {
  const n = (people += 1)
  const person = {
    user: { id: `user_limit_${n}_${run}`, email: `limit-${n}-${run}@example.com`, name: `Limit ${n}` },
    sessionId: null,
  }
  workos.people[`code-limit-${n}-${run}`] = person
  const signIn = async () => {
    const response = await app.request('/auth/callback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: `code-limit-${n}-${run}` }),
    })
    return SignedIn.parse(await response.json())
  }
  return { person, signIn }
}

/** Asks the app in workspace A with a session token. */
async function withToken(token: string, method: string, path: string, body?: unknown) {
  const response = await app.request(`/workspaces/${workspace.id}${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: response.status, json: (await response.json()) as unknown }
}

const brandIdsOf = async (as: string) =>
  BrandSummary.array()
    .parse((await call(as, 'GET', '/brands')).json)
    .map((b) => b.id)

const memberIn = async (as: string, userId: string) =>
  WorkspaceMember.array()
    .parse((await call(as, 'GET', '/members')).json)
    .find((m) => m.id === userId)

/** Makes a brand of workspace A that no test has used yet. */
async function addBrand() {
  const added = { id: `brand-limit-${randomUUID().slice(0, 8)}`, workspaceId: workspace.id, name: 'Brand Late' }
  await db.insert(brands).values(added)
  return added
}

describe('an invite with brands', () => {
  it('makes a member limited to its brands, whom making an Admin frees', async () => {
    const { person, signIn } = newPerson()
    const sent = await call('a', 'POST', '/invites', {
      email: person.user.email,
      role: 'reviewer',
      brandIds: [sibling.id, sibling.id],
    })
    expect(sent.status).toBe(201)
    expect(Invite.parse(sent.json).brandIds).toEqual([sibling.id])
    const listed = Invite.array()
      .parse((await call('a', 'GET', '/invites')).json)
      .find((i) => i.email === person.user.email)
    expect(listed?.brandIds).toEqual([sibling.id])

    const invitation = workos.made.invitations.find((i) => i.email === person.user.email)
    workos.accept(invitation?.id ?? '', person.user.id)
    const { token } = await signIn()
    const listedBrands = BrandSummary.array().parse((await withToken(token, 'GET', '/brands')).json)
    expect(listedBrands.map((b) => b.id)).toEqual([sibling.id])
    expect((await withToken(token, 'GET', `/brands/${brand.id}/designs`)).status).toBe(404)

    const member = WorkspaceMember.array()
      .parse((await call('a', 'GET', '/members')).json)
      .find((m) => m.email === person.user.email)
    expect(member).toMatchObject({ role: 'reviewer', brandIds: [sibling.id] })

    const admin = await call('a', 'PATCH', `/members/${member?.id}`, { role: 'admin' })
    expect(admin).toEqual({ status: 200, json: { ...member, role: 'admin', brandIds: null } })
    expect(BrandSummary.array().parse((await withToken(token, 'GET', '/brands')).json).length).toBeGreaterThan(1)
    // Made an Editor again, they see every brand still.
    const editor = await call('a', 'PATCH', `/members/${member?.id}`, { role: 'editor' })
    expect(WorkspaceMember.parse(editor.json).brandIds).toBeNull()
  })

  it('makes a limited member with no brands when every brand of the invite is gone before it is accepted', async () => {
    const { person, signIn } = newPerson()
    const late = await addBrand()
    const sent = await call('a', 'POST', '/invites', { email: person.user.email, role: 'editor', brandIds: [late.id] })
    expect(sent.status).toBe(201)
    await db.delete(brands).where(and(eq(brands.id, late.id), eq(brands.workspaceId, workspace.id)))

    const invitation = workos.made.invitations.find((i) => i.email === person.user.email)
    workos.accept(invitation?.id ?? '', person.user.id)
    const { token } = await signIn()
    expect(await withToken(token, 'GET', '/brands')).toEqual({ status: 200, json: [] })
    const member = WorkspaceMember.array()
      .parse((await call('a', 'GET', '/members')).json)
      .find((m) => m.email === person.user.email)
    expect(member).toMatchObject({ role: 'editor', brandIds: [] })
  })

  it('resends a pending invite with the new brands', async () => {
    const { person } = newPerson()
    await call('a', 'POST', '/invites', { email: person.user.email, role: 'editor', brandIds: [brand.id] })
    const again = await call('a', 'POST', '/invites', { email: person.user.email, role: 'editor' })
    expect(Invite.parse(again.json).brandIds).toBeNull()
  })

  it('refuses a limit with no brands, with a brand of another workspace, or on an Admin', async () => {
    const { person } = newPerson()
    const email = person.user.email
    const refusals = await Promise.all([
      call('a', 'POST', '/invites', { email, role: 'editor', brandIds: [] }),
      call('a', 'POST', '/invites', { email, role: 'editor', brandIds: [brand.id, otherBrand.id] }),
      call('a', 'POST', '/invites', { email, role: 'editor', brandIds: ['no-such-brand'] }),
      call('a', 'POST', '/invites', { email, role: 'admin', brandIds: [brand.id] }),
    ])
    expect(refusals.map((r) => r.status)).toEqual([400, 400, 400, 400])
    expect(refusals.slice(1).map((r) => r.json)).toEqual([
      { error: 'Limit a member to brands of this workspace' },
      { error: 'Limit a member to brands of this workspace' },
      { error: 'Only an Editor or Reviewer can be limited to some brands' },
    ])
    expect(
      Invite.array()
        .parse((await call('a', 'GET', '/invites')).json)
        .map((i) => i.email),
    ).not.toContain(email)
  })
})

describe('changing a member’s brands', () => {
  it('limits an Editor, changes their brands, and frees them again', async () => {
    const editor = await addPerson([[workspace.id, 'editor']])
    const limit = async (brandIds: string[] | null) => call('a', 'PATCH', `/members/${editor.id}`, { brandIds })
    expect((await limit([brand.id])).json).toMatchObject({ role: 'editor', brandIds: [brand.id] })
    expect(await brandIdsOf(editor.as)).toEqual([brand.id])
    expect((await limit([sibling.id])).status).toBe(200)
    expect(await brandIdsOf(editor.as)).toEqual([sibling.id])
    expect((await limit(null)).json).toMatchObject({ brandIds: null })
    expect(await brandIdsOf(editor.as)).toEqual(expect.arrayContaining([brand.id, sibling.id]))
  })

  it('keeps the limit when an Editor is made a Reviewer, and takes both at once', async () => {
    const editor = await addPerson([[workspace.id, 'editor', [brand.id]]])
    expect((await call('a', 'PATCH', `/members/${editor.id}`, { role: 'reviewer' })).json).toMatchObject({
      role: 'reviewer',
      brandIds: [brand.id],
    })
    const both = await call('admin', 'PATCH', `/members/${editor.id}`, { role: 'editor', brandIds: [sibling.id] })
    expect(both.json).toMatchObject({ role: 'editor', brandIds: [sibling.id] })
  })

  it('refuses a limit with no brands, with a brand of another workspace, on an Admin, or by an Editor', async () => {
    const editor = await addPerson([[workspace.id, 'editor', [brand.id]]])
    const admin = await addPerson([[workspace.id, 'admin']])
    const patch = (as: string, userId: string, change: unknown) => call(as, 'PATCH', `/members/${userId}`, change)
    expect((await patch('a', editor.id, { brandIds: [] })).status).toBe(400)
    expect(await patch('a', editor.id, { brandIds: [otherBrand.id] })).toEqual({
      status: 400,
      json: { error: 'Limit a member to brands of this workspace' },
    })
    expect(await patch('a', admin.id, { brandIds: [brand.id] })).toEqual({
      status: 400,
      json: { error: 'Only an Editor or Reviewer can be limited to some brands' },
    })
    expect(await patch('a', editor.id, { role: 'admin', brandIds: [brand.id] })).toEqual({
      status: 400,
      json: { error: 'Only an Editor or Reviewer can be limited to some brands' },
    })
    expect((await patch('editor', editor.id, { brandIds: null })).status).toBe(403)
    expect((await patch('a', editor.id, {})).status).toBe(400)
    // Nothing refused changed anything.
    expect(await memberIn('a', editor.id)).toMatchObject({ role: 'editor', brandIds: [brand.id] })
    expect(await memberIn('a', admin.id)).toMatchObject({ role: 'admin', brandIds: null })
  })

  it('refuses the sync token for a design of a brand taken away, and its next request', async () => {
    const editor = await addPerson([[workspace.id, 'editor', [brand.id, sibling.id]]])
    const design = DesignSummary.parse((await call('a', 'POST', `/brands/${brand.id}/designs`, { name: 'Lost' })).json)
    const token = `/brands/${brand.id}/designs/${design.id}/sync-token`
    expect((await call(editor.as, 'POST', token)).status).toBe(200)
    expect((await call('a', 'PATCH', `/members/${editor.id}`, { brandIds: [sibling.id] })).status).toBe(200)
    expect(await call(editor.as, 'POST', token)).toEqual({ status: 404, json: { error: 'No such brand' } })
    expect((await call(editor.as, 'GET', `/brands/${brand.id}/designs/${design.id}`)).status).toBe(404)
  })

  it('lists no brands, not all, for a member whose last brand is gone', async () => {
    const late = await addBrand()
    const reviewer = await addPerson([[workspace.id, 'reviewer', [late.id]]])
    expect(await brandIdsOf(reviewer.as)).toEqual([late.id])
    await db.delete(brands).where(and(eq(brands.id, late.id), eq(brands.workspaceId, workspace.id)))
    expect(await brandIdsOf(reviewer.as)).toEqual([])
    expect(await memberIn('a', reviewer.id)).toMatchObject({ brandIds: [] })
  })
})

describe('a limited member', () => {
  it('sees each member’s brands only where they are their own', async () => {
    const reviewer = await addPerson([[workspace.id, 'reviewer', [sibling.id]]])
    const both = await addPerson([[workspace.id, 'editor', [brand.id, sibling.id]]])
    const elsewhere = await addPerson([[workspace.id, 'editor', [brand.id]]])
    const seen = WorkspaceMember.array().parse((await call(reviewer.as, 'GET', '/members')).json)
    const brandsSeen = new Set(seen.flatMap((m) => m.brandIds ?? []))
    expect([...brandsSeen]).toEqual([sibling.id])
    expect(seen.find((m) => m.id === both.id)?.brandIds).toEqual([sibling.id])
    expect(seen.find((m) => m.id === elsewhere.id)?.brandIds).toEqual([])
    expect(seen.find((m) => m.role === 'owner')?.brandIds).toBeNull()
    // The Owner sees them all.
    expect(await memberIn('a', both.id)).toMatchObject({ brandIds: [brand.id, sibling.id].sort() })
  })

  it('still sees the workspace’s templates in their brand', { timeout: 60_000 }, async () => {
    const saved = await call('a', 'POST', `/brands/${brand.id}/templates`, {
      name: 'Shared',
      scope: 'workspace',
      content: blank,
    })
    expect(saved.status).toBe(201)
    const template = TemplateSummary.parse(saved.json)
    const editor = await addPerson([[workspace.id, 'editor', [sibling.id]]])
    const listed = TemplateSummary.array().parse((await call(editor.as, 'GET', `/brands/${sibling.id}/templates`)).json)
    expect(listed.map((t) => t.id)).toContain(template.id)
    expect((await request(editor.as, 'GET', `/workspaces/${workspace.id}/brands/${brand.id}/templates`)).status).toBe(
      404,
    )
  })

  it(
    'starts a design from a workspace template, but can’t save, rename or delete one',
    { timeout: 60_000 },
    async () => {
      const save = (as: string, scope: string) =>
        call(as, 'POST', `/brands/${sibling.id}/templates`, { name: 'Shared', scope, content: blank })
      const shared = TemplateSummary.parse((await save('a', 'workspace')).json)
      const editor = await addPerson([[workspace.id, 'editor', [sibling.id]]])
      const refused = { error: 'A member limited to some brands can’t change a template for every brand' }
      const ofShared = `/brands/${sibling.id}/templates/${shared.id}`

      expect(await save(editor.as, 'workspace')).toEqual({ status: 403, json: refused })
      expect(await call(editor.as, 'PATCH', ofShared, { name: 'Mine' })).toEqual({ status: 403, json: refused })
      expect(await call(editor.as, 'DELETE', ofShared)).toEqual({ status: 403, json: refused })
      expect((await call(editor.as, 'POST', `${ofShared}/designs`, {})).status).toBe(201)
      // The refused changes left it as it was.
      const listed = TemplateSummary.array().parse((await call('a', 'GET', `/brands/${sibling.id}/templates`)).json)
      expect(listed.find((t) => t.id === shared.id)?.name).toBe('Shared')

      // Their brand's own templates they save, rename and delete.
      const own = TemplateSummary.parse((await save(editor.as, 'brand')).json)
      const ofOwn = `/brands/${sibling.id}/templates/${own.id}`
      expect((await call(editor.as, 'PATCH', ofOwn, { name: 'Mine' })).status).toBe(200)
      expect((await call(editor.as, 'DELETE', ofOwn)).status).toBe(204)
    },
  )
})

describe('the memberships table', () => {
  it('refuses a limit on any role but Editor or Reviewer', async () => {
    const admin = await addPerson([[workspace.id, 'admin']])
    const ofAdmin = and(eq(memberships.workspaceId, workspace.id), eq(memberships.userId, admin.id))
    const refused = { cause: { constraint: 'memberships_limited_role' } }
    await expect(db.update(memberships).set({ limited: true }).where(ofAdmin)).rejects.toMatchObject(refused)
    await expect(addPerson([[workspace.id, 'owner', [brand.id]]])).rejects.toMatchObject(refused)
    // An Editor may be limited.
    const editor = await addPerson([[workspace.id, 'editor']])
    const ofEditor = and(eq(memberships.workspaceId, workspace.id), eq(memberships.userId, editor.id))
    await db.update(memberships).set({ limited: true }).where(ofEditor)
    expect(await brandIdsOf(editor.as)).toEqual([])
  })
})
