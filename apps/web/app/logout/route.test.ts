// The sign-out route handler, run in Node with the request's cookies and the API stubbed.
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { signOutLink } from '@/lib/server/api.ts'

import { POST } from './route.ts'

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ cookies: vi.fn() }))
vi.mock('@/lib/server/api.ts', async (original) => ({
  SESSION_COOKIE: (await original<typeof import('@/lib/server/api.ts')>()).SESSION_COOKIE,
  signOutLink: vi.fn(),
}))

const { cookies } = await import('next/headers')

beforeEach(() => {
  // A session the sign-out would forget.
  vi.mocked(cookies).mockResolvedValue({
    has: () => true,
    delete: () => undefined,
  } as unknown as Awaited<ReturnType<typeof cookies>>)
  vi.mocked(signOutLink).mockResolvedValue('http://localhost:3000/login')
})

describe('POST /logout', () => {
  it('refuses a sign-out sent from another site with 403, before any cookie is read', async () => {
    const response = await POST(
      new NextRequest('http://localhost:3000/logout', { method: 'POST', headers: { 'sec-fetch-site': 'cross-site' } }),
    )

    expect([response.status, response.headers.get('location')]).toEqual([403, null])
    expect(cookies).not.toHaveBeenCalled()
    expect(signOutLink).not.toHaveBeenCalled()
  })
})
