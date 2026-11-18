// The signed-in person's own summary, against Postgres from Docker Compose
// (`docker compose up -d --wait postgres`).
import { describe, expect, it } from 'vitest'

import { Me } from '@dazbee/schema'

import { addPerson, brand, call, other, personBoth, request, workspace } from '../test-api.ts'

const me = async (as: string) => Me.parse((await request(as, 'GET', '/me')).json)
/** Opens the workspace's page as the person in both workspaces. */
const visit = (workspaceId: string) => call({ as: 'both', workspace: workspaceId }, 'GET', '')

describe('GET /me', () => {
  it('names the person and their workspaces by name with their role, and opens the first joined before any visit', async () => {
    expect(await me('both')).toEqual({
      id: personBoth.id,
      name: 'Bea Both',
      email: personBoth.email,
      workspaces: [
        { ...workspace, role: 'editor', limited: false },
        { ...other, role: 'editor', limited: false },
      ],
      open: other.id,
    })
  })

  it('says where the person is limited to some brands', async () => {
    const limited = await addPerson([
      [workspace.id, 'reviewer', [brand.id]],
      [other.id, 'editor'],
    ])
    expect((await me(limited.as)).workspaces).toEqual([
      { ...workspace, role: 'reviewer', limited: true },
      { ...other, role: 'editor', limited: false },
    ])
  })

  it('opens the workspace used last', async () => {
    expect((await visit(other.id)).status).toBe(200)
    expect((await visit(workspace.id)).status).toBe(200)
    expect((await me('both')).open).toBe(workspace.id)
    await visit(other.id)
    expect((await me('both')).open).toBe(other.id)
  })

  it('refuses a request without a session', async () => {
    expect(await request(null, 'GET', '/me')).toEqual({ status: 401, json: { error: 'Sign in first' } })
  })
})
