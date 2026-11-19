// The development session against Postgres from Docker Compose
// (`docker compose up -d --wait postgres`).
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { memberships, users } from '@dazbee/db'
import { DesignSummary, Me, VersionSummary } from '@dazbee/schema'

import { createApp } from '../app.ts'
import { addPerson, db, storage, syncSecret } from '../test-api.ts'
import { DEV_BRANDS, DEV_USER, DEV_WORKSPACE, devSession, seedDevelopment } from './session.ts'

describe('seedDevelopment', () => {
  const app = createApp({ db, storage, sessionOf: devSession, syncSecret, build: 'test-build' })
  const ask = async (method: string, path: string, body?: unknown) => {
    const response = await app.request(path, {
      method,
      headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    return { status: response.status, json: response.status === 204 ? null : ((await response.json()) as unknown) }
  }

  it('makes the development user the Owner of the development workspace, and runs again harmlessly', async () => {
    await seedDevelopment(db)
    await seedDevelopment(db)
    expect(Me.parse((await ask('GET', '/me')).json)).toEqual({
      id: DEV_USER.id,
      name: 'Development user',
      email: 'dev@localhost',
      workspaces: [{ ...DEV_WORKSPACE, role: 'owner', limited: false }],
      open: DEV_WORKSPACE.id,
    })
  })

  it('makes no second Owner once the development user has handed over Owner and left', async () => {
    await seedDevelopment(db)
    const admin = await addPerson([[DEV_WORKSPACE.id, 'admin']])
    const owners = () =>
      db
        .select({ userId: memberships.userId })
        .from(memberships)
        .where(and(eq(memberships.workspaceId, DEV_WORKSPACE.id), eq(memberships.role, 'owner')))
    try {
      expect((await ask('POST', `/workspaces/${DEV_WORKSPACE.id}/members/${admin.id}/owner`)).status).toBe(204)
      expect((await ask('POST', `/workspaces/${DEV_WORKSPACE.id}/leave`)).status).toBe(204)
      await seedDevelopment(db)
      expect(await owners()).toEqual([{ userId: admin.id }])
    } finally {
      await db.delete(users).where(eq(users.id, admin.id))
      await db
        .delete(memberships)
        .where(and(eq(memberships.workspaceId, DEV_WORKSPACE.id), eq(memberships.userId, DEV_USER.id)))
      await seedDevelopment(db)
    }
    expect(await owners()).toEqual([{ userId: DEV_USER.id }])
  })

  it('adds the development user, so a version the development session saves names them', async () => {
    await seedDevelopment(db)
    const at = (path: string) => `/workspaces/${DEV_WORKSPACE.id}/brands/${DEV_BRANDS[0]?.id ?? ''}${path}`
    const design = DesignSummary.parse((await ask('POST', at('/designs'), { name: 'Seeded' })).json)
    const saved = await ask('POST', at(`/designs/${design.id}/versions`), { name: 'Kept' })
    expect(saved.status).toBe(201)
    expect(VersionSummary.parse(saved.json).savedBy).toBe('Development user')
  })
})
