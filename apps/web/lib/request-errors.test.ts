// The log line of an error a request met: route, path and kind, never the query or the error's message.
import { afterEach, describe, expect, it, vi } from 'vitest'

import { onRequestError } from './request-errors.ts'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('onRequestError', () => {
  it("writes the route, the path without its query, and the error's kind and digest, leaving out its message", async () => {
    const lines: string[] = []
    vi.spyOn(console, 'log').mockImplementation((line: string) => void lines.push(line))
    const error = Object.assign(new TypeError('no reply for ada@example.com'), { digest: '12345' })

    await onRequestError(
      error,
      { path: '/callback?code=a-code&state=a-state', method: 'GET', headers: {} },
      { routerKind: 'App Router', routePath: '/callback', routeType: 'route', revalidateReason: undefined },
    )

    expect(lines.map((line) => JSON.parse(line) as unknown)).toEqual([
      {
        event: 'request-error',
        method: 'GET',
        path: '/callback',
        route: '/callback',
        kind: 'route',
        error: 'TypeError',
        digest: '12345',
      },
    ])
    expect(lines.join(' ')).not.toMatch(/example\.com|a-code|a-state/)
  })
})
