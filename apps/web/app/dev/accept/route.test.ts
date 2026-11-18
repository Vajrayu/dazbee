// The development invite link's route handler, run in Node with the request's cookies held in a map and
// the API's answers stubbed: what it asks the API, the session it keeps and where it sends the person.
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SESSION_COOKIE } from '@/lib/server/api.ts'

import { GET } from './route.ts'

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ cookies: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))

const { cookies } = await import('next/headers')

/** The browser's cookies as the route sees them, by name. */
let jar: Map<string, string>
/** The options each cookie was last set with, by name. */
let setWith: Map<string, unknown>
/** The requests the route sent the API: path and body. */
let asked: { path: string; body: unknown }[]
/** What the API answers `POST /auth/dev/accept` with. */
let answer: { status: number; body: unknown }

beforeEach(() => {
  jar = new Map()
  setWith = new Map()
  asked = []
  answer = { status: 200, body: { token: 'a-session-token', expiresAt: Date.UTC(2099, 0, 1), open: 'workspace-2' } }
  vi.mocked(cookies).mockResolvedValue({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
    set: (name: string, value: string, options: unknown) => {
      jar.set(name, value)
      setWith.set(name, options)
    },
    delete: (name: string) => void jar.delete(name),
  } as unknown as Awaited<ReturnType<typeof cookies>>)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      asked.push({ path: new URL(url).pathname, body: init?.body ? JSON.parse(String(init.body)) : null })
      return new Response(JSON.stringify(answer.body), { status: answer.status })
    }),
  )
})

describe('GET /dev/accept', () => {
  it("accepts the invite its link names, keeps the invited person's session and opens the invited workspace", async () => {
    const response = await GET(new NextRequest('http://localhost:3000/dev/accept?invite=invite-1'))

    expect(asked).toEqual([{ path: '/auth/dev/accept', body: { invite: 'invite-1' } }])
    expect([response.status, response.headers.get('location')]).toEqual([303, 'http://localhost:3000/w/workspace-2'])
    expect(jar.get(SESSION_COOKIE)).toBe('a-session-token')
  })

  it('keeps the session as /callback does: httpOnly, Secure over https, and until the session ends', async () => {
    await GET(new NextRequest('https://dazbee.example/dev/accept?invite=invite-1'))

    expect(setWith.get(SESSION_COOKIE)).toEqual({
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: true,
      expires: new Date(Date.UTC(2099, 0, 1)),
    })
  })

  it('is not found when the API has no such invite or no development accept, and keeps the session there was', async () => {
    jar.set(SESSION_COOKIE, 'the-session-before')
    answer = { status: 404, body: { error: 'Not found' } }

    const response = await GET(new NextRequest('http://localhost:3000/dev/accept?invite=invite-1'))

    expect(response.status).toBe(404)
    expect(jar.get(SESSION_COOKIE)).toBe('the-session-before')
  })

  it('sends a revoked, expired or used link to sign-in, saying so, and keeps the session there was', async () => {
    jar.set(SESSION_COOKIE, 'the-session-before')
    answer = { status: 400, body: { error: 'This invite has expired, was revoked or was already used' } }

    const response = await GET(new NextRequest('http://localhost:3000/dev/accept?invite=invite-1'))

    expect([response.status, response.headers.get('location')]).toEqual([
      303,
      'http://localhost:3000/login?invite=unusable',
    ])
    expect(jar.get(SESSION_COOKIE)).toBe('the-session-before')
  })

  it('is not found, without asking the API, for a link that names no invite', async () => {
    for (const url of ['http://localhost:3000/dev/accept', 'http://localhost:3000/dev/accept?invite=not%20an%20id']) {
      const response = await GET(new NextRequest(url))

      expect(response.status).toBe(404)
    }
    expect(asked).toEqual([])
  })
})
