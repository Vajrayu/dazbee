// The WorkOS callback's route handler, run in Node with the request's cookies held in a map and the
// API's sign-in stubbed; a refusal keeps no session in that map or on its response.
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { completeSignIn, SESSION_COOKIE } from '@/lib/server/api.ts'
import { INVITATION_COOKIE, STATE_COOKIE } from '@/lib/server/sign-in.ts'

import { GET } from './route.ts'

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ cookies: vi.fn() }))
vi.mock('@/lib/server/api.ts', async (original) => ({
  SESSION_COOKIE: (await original<typeof import('@/lib/server/api.ts')>()).SESSION_COOKIE,
  completeSignIn: vi.fn(),
}))

const { cookies } = await import('next/headers')

/** The browser's cookies as the route sees them, by name. */
let jar: Map<string, string>

beforeEach(() => {
  jar = new Map()
  vi.mocked(cookies).mockResolvedValue({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  } as unknown as Awaited<ReturnType<typeof cookies>>)
  vi.mocked(completeSignIn).mockReset()
  vi.mocked(completeSignIn).mockResolvedValue({
    token: 'a-session-token',
    expiresAt: Date.UTC(2099, 0, 1),
    open: 'workspace-1',
  })
})

describe('GET /callback', () => {
  it('keeps the session and opens the workspace the sign-in answer names', async () => {
    jar.set(STATE_COOKIE, 'the-one-we-started')

    const response = await GET(new NextRequest('http://localhost:3000/callback?code=good&state=the-one-we-started'))

    expect([response.status, response.headers.get('location')]).toEqual([303, 'http://localhost:3000/w/workspace-1'])
    expect(jar.get(SESSION_COOKIE)).toBe('a-session-token')
    expect(jar.has(STATE_COOKIE)).toBe(false)
    expect(completeSignIn).toHaveBeenCalledWith('good')
  })

  it("forgets the invite's token the sign-in started from once it signs in", async () => {
    jar.set(STATE_COOKIE, 'the-one-we-started')
    jar.set(INVITATION_COOKIE, 'invite_Token-1')

    await GET(new NextRequest('http://localhost:3000/callback?code=good&state=the-one-we-started'))

    expect(jar.has(INVITATION_COOKIE)).toBe(false)
  })

  it("sends a refused sign-in back to sign in with the invite's token, so trying again still accepts the invite", async () => {
    for (const [url, signIn] of [
      ['http://localhost:3000/callback?code=made-up&state=not-the-one', null],
      ['http://localhost:3000/callback?code=good&state=the-one-we-started', new Error('The API refused the code')],
    ] as const) {
      jar.set(STATE_COOKIE, 'the-one-we-started')
      jar.set(INVITATION_COOKIE, 'invite_Token-1')
      if (signIn) vi.mocked(completeSignIn).mockRejectedValueOnce(signIn)

      const response = await GET(new NextRequest(url))

      expect([response.status, response.headers.get('location')]).toEqual([
        303,
        'http://localhost:3000/login?error=1&invitation_token=invite_Token-1',
      ])
      expect(jar.has(INVITATION_COOKIE)).toBe(false)
      expect(jar.has(SESSION_COOKIE)).toBe(false)
    }
  })

  it('refuses a state this browser did not start with: back to the sign-in page with its error, no session kept', async () => {
    jar.set(STATE_COOKIE, 'the-one-we-started')

    const response = await GET(new NextRequest('http://localhost:3000/callback?code=made-up&state=not-the-one'))

    expect([response.status, response.headers.get('location')]).toEqual([303, 'http://localhost:3000/login?error=1'])
    expect([...jar.keys()]).toEqual([])
    expect(response.cookies.get(SESSION_COOKIE)).toBeUndefined()
    expect(completeSignIn).not.toHaveBeenCalled()
  })

  it('refuses a callback when this browser started no sign-in', async () => {
    const response = await GET(new NextRequest('http://localhost:3000/callback?code=made-up&state=any'))

    expect([response.status, response.headers.get('location')]).toEqual([303, 'http://localhost:3000/login?error=1'])
    expect(jar.has(SESSION_COOKIE)).toBe(false)
    expect(response.cookies.get(SESSION_COOKIE)).toBeUndefined()
    expect(completeSignIn).not.toHaveBeenCalled()
  })
})
