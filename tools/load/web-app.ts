// The web app as one signed-in person's browser asks it, with their session cookie: the design page, the
// sync token the editor fetches through the page's server action, the Brands page and an image upload.
// The server action is called the way the browser's Next.js client calls it, by the id the page's scripts
// give `fetchSyncToken`, which findSyncTokenAction reads once.
import type { LoadPerson } from './load-workspace.ts'

/** What one person asks the web app. */
export interface WebApp {
  /** Loads the person's design page. */
  designPage(): Promise<void>
  /** A fresh sync token for the person's design. */
  syncToken(): Promise<string>
  /** Loads the Brands page. */
  brandsPage(): Promise<void>
  /** Uploads a PNG to the brand's asset library. */
  upload(png: Uint8Array): Promise<void>
}

/** The web app's session cookie (apps/web/lib/server/api.ts). */
const SESSION_COOKIE = 'dazbee_session'

/** How long a request may take before it counts as failed. */
const REQUEST_TIMEOUT_MS = 30_000

/** Says who is asking, so the requests can be told apart in logs. */
const USER_AGENT = 'dazbee-load-test'

/** How a page's scripts name the sync token's server action: Next.js's `createServerReference(id, …, "fetchSyncToken")`. */
const SYNC_TOKEN_ACTION = /createServerReference\)\("([0-9a-f]+)",[^,()]+,void 0,[^,()]+,"fetchSyncToken"\)/

/** The id of the design page's `fetchSyncToken` server action, read from the scripts the page loads. */
export async function findSyncTokenAction(webUrl: string, workspaceId: string, person: LoadPerson): Promise<string> {
  const page = await ask(webUrl, designPath(workspaceId, person), person, { expect: 200 })
  const html = await page.text()
  const scripts = new Set([...html.matchAll(/\/_next\/static\/chunks\/[\w./-]+\.js/g)].map((match) => match[0]))
  for (const script of scripts) {
    const response = await fetch(`${webUrl}${script}`, { headers: { 'user-agent': USER_AGENT } })
    const found = SYNC_TOKEN_ACTION.exec(await response.text())
    if (found?.[1]) return found[1]
  }
  throw new Error(`none of the design page's ${scripts.size} scripts names the fetchSyncToken action`)
}

/** The web app as `person` asks it. */
export function webAppAs(webUrl: string, workspaceId: string, person: LoadPerson, actionId: string): WebApp {
  const design = designPath(workspaceId, person)
  return {
    async designPage() {
      await (await ask(webUrl, design, person, { expect: 200 })).arrayBuffer()
    },
    async syncToken() {
      const response = await ask(webUrl, design, person, {
        expect: 200,
        method: 'POST',
        headers: {
          'next-action': actionId,
          accept: 'text/x-component',
          'content-type': 'text/plain;charset=UTF-8',
          origin: webUrl,
        },
        body: JSON.stringify([workspaceId, person.brandId, person.designId]),
      })
      return tokenOf(await response.text())
    },
    async brandsPage() {
      await (await ask(webUrl, `/w/${workspaceId}`, person, { expect: 200 })).arrayBuffer()
    },
    async upload(png) {
      const form = new FormData()
      form.append('file', new File([png], 'load-test.png', { type: 'image/png' }))
      const path = `/w/${workspaceId}/brands/${person.brandId}/assets`
      await (await ask(webUrl, path, person, { expect: 201, method: 'POST', body: form })).arrayBuffer()
    },
  }
}

/** The token in a server action's answer, Next.js's flight lines (`0:{…}`, `1:{"token":…}`). */
export function tokenOf(flight: string): string {
  for (const line of flight.split('\n')) {
    const json = line.slice(line.indexOf(':') + 1)
    if (!json.startsWith('{')) continue
    const value = JSON.parse(json) as { token?: unknown }
    if (typeof value.token === 'string') return value.token
  }
  throw new Error(`the sync token action answered no token: ${flight.slice(0, 200)}`)
}

function designPath(workspaceId: string, person: LoadPerson) {
  return `/w/${workspaceId}/brands/${person.brandId}/designs/${person.designId}`
}

/** One request with the person's session cookie; throws unless it answers `expect`. */
async function ask(
  webUrl: string,
  path: string,
  person: LoadPerson,
  { expect, ...init }: RequestInit & { expect: number },
): Promise<Response> {
  const response = await fetch(`${webUrl}${path}`, {
    ...init,
    redirect: 'manual',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      ...(init.headers as Record<string, string> | undefined),
      cookie: `${SESSION_COOKIE}=${person.sessionToken}`,
      'user-agent': USER_AGENT,
    },
  })
  if (response.status !== expect) {
    await response.body?.cancel()
    throw new Error(`${init.method ?? 'GET'} ${path} answered ${response.status}`)
  }
  return response
}
