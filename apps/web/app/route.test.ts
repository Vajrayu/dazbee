// The `/` route handler, run in Node with the request's cookies held in a map and the API stubbed.
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { findMe, SESSION_COOKIE, signOutLink } from '@/lib/server/api.ts'

import { GET } from './route.ts'

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ cookies: vi.fn() }))
vi.mock('@/lib/server/api.ts', async (original) => ({
  SESSION_COOKIE: (await original<typeof import('@/lib/server/api.ts')>()).SESSION_COOKIE,
  findMe: vi.fn(),
  signOutLink: vi.fn(),
}))

const { cookies } = await import('next/headers')

/** The browser's cookies as the route sees them, by name. */
let jar: Map<string, string>

const me = (open: string | null) => ({
  id: 'user-1',
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  workspaces: open ? [{ id: open, name: 'Harbour', role: 'owner' as const, limited: false }] : [],
  open,
})

beforeEach(() => {
  jar = new Map([[SESSION_COOKIE, 'a-session-token']])
  vi.mocked(cookies).mockResolvedValue({
    has: (name: string) => jar.has(name),
    delete: (name: string) => void jar.delete(name),
  } as unknown as Awaited<ReturnType<typeof cookies>>)
  vi.mocked(findMe).mockReset()
  vi.mocked(signOutLink).mockReset()
  vi.mocked(signOutLink).mockResolvedValue(null)
})

describe('GET /', () => {
  it('opens the workspace the API says to open', async () => {
    vi.mocked(findMe).mockResolvedValue(me('workspace-1'))

    const response = await GET()

    expect(response.headers.get('location')).toBe('/w/workspace-1')
    expect(jar.get(SESSION_COOKIE)).toBe('a-session-token')
    expect(signOutLink).not.toHaveBeenCalled()
  })

  it('signs out a person with no workspace to open, as sign-out does', async () => {
    vi.mocked(findMe).mockResolvedValue(me(null))
    vi.mocked(signOutLink).mockResolvedValue('https://auth.example.com/logout')

    const response = await GET()

    expect(response.headers.get('location')).toBe('https://auth.example.com/logout')
    expect(jar.has(SESSION_COOKIE)).toBe(false)
  })

  it('sends a person who is not signed in to sign in, on the address the browser used, which a proxy hides from the server', async () => {
    jar.clear()
    vi.mocked(findMe).mockResolvedValue(null)

    const response = await GET()

    expect(response.headers.get('location')).toBe('/login')
    expect(signOutLink).not.toHaveBeenCalled()
  })
})
