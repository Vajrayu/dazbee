// Early access's routes, against Postgres from Docker Compose, with the WorkOS stand-in: /admin answers
// anyone but an admin 404, and the waiting list takes requests to join, limited per address and checked by
// Turnstile when it is set up, which an admin invites or dismisses.
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { accessRequests } from '@dazbee/db'
import { AccessRequest, DazbeeInvite, DazbeeInvites } from '@dazbee/schema'

import { addPerson, db, run, workos, workspace } from '../test-api.ts'
import { addAdmin, app, ask, earlyApp, tokenOf } from './test-early-access.ts'
import { siteverify } from './turnstile.ts'
import { REQUESTS_PER_WINDOW } from './waiting-list.ts'

let admin: Awaited<ReturnType<typeof addAdmin>>

/** Cloudflare's siteverify as the Turnstile tests see it: only `good-token` with `the-secret` passes. */
let siteverifyServer: Server
let siteverifyUrl = ''
/** The forms the stand-in was sent. */
const verified: URLSearchParams[] = []

beforeAll(async () => {
  admin = await addAdmin()
  siteverifyServer = createServer((req, res) => {
    let text = ''
    req.on('data', (chunk: Buffer) => (text += chunk.toString()))
    req.on('end', () => {
      const form = new URLSearchParams(text)
      verified.push(form)
      const success = form.get('secret') === 'the-secret' && form.get('response') === 'good-token'
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ success }))
    })
  })
  await new Promise<void>((resolve) => siteverifyServer.listen(0, '127.0.0.1', resolve))
  siteverifyUrl = `http://127.0.0.1:${(siteverifyServer.address() as AddressInfo).port}/siteverify`
})

afterAll(async () => {
  await new Promise((resolve) => siteverifyServer.close(resolve))
})

let addresses = 0
/** An address of its own for each test, so their requests never share a limit. */
const newAddress = () => `203.0.113.${(addresses += 1)}`

let requests = 0
/** A request to join from a new email. */
const newRequest = () => ({
  email: `waiting-${(requests += 1)}-${run}@example.com`,
  name: `Waiting ${requests}`,
  company: 'Harbour Coffee',
  note: 'Ads for our spring menu',
})

/** Sends a request to join from `address` to `on`. */
async function requestToJoin(body: unknown, address: string, on = app) {
  const response = await on.request('/access-requests', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': address },
    body: JSON.stringify(body),
  })
  return response.status
}

/** The stored request of an email. */
async function storedRequest(email: string) {
  return db
    .select({ name: accessRequests.name, note: accessRequests.note, invitedAt: accessRequests.invitedAt })
    .from(accessRequests)
    .where(eq(accessRequests.email, email))
}

/** The waiting list as the admin page shows it. */
async function waitingList() {
  return AccessRequest.array().parse((await ask(admin.token, 'GET', '/admin/access-requests')).json)
}

describe('/admin', () => {
  it('answers anyone but an admin 404 on every route, whatever route is added later', async () => {
    // A workspace's Admin is no admin of Dazbee.
    const member = await addPerson([[workspace.id, 'admin']])
    const routes = [...new Set(app.routes.filter((r) => r.path.startsWith('/admin/') && r.method !== 'ALL'))]
    expect(routes.map((r) => `${r.method} ${r.path}`)).toEqual(
      expect.arrayContaining(['GET /admin/invites', 'POST /admin/invites', 'POST /admin/invites/:inviteId/remove']),
    )
    const answered = []
    for (const route of routes) {
      const path = route.path.replace(/:\w+/g, 'any')
      for (const token of [null, tokenOf(member.id)]) {
        const { status, json } = await ask(token, route.method, path, route.method === 'GET' ? undefined : {})
        if (status !== 404 || JSON.stringify(json) !== '{"error":"Not found"}')
          answered.push(`${route.method} ${route.path} ${token ? 'as a member' : 'signed out'}: ${status}`)
      }
    }
    expect(answered).toEqual([])
  })

  it('lists the pending invites, the people who joined and those removed, for an admin', async () => {
    const answer = await ask(admin.token, 'GET', '/admin/invites')
    expect(answer.status).toBe(200)
    expect(DazbeeInvites.safeParse(answer.json).success).toBe(true)
  })
})

describe('requests to join', () => {
  it('makes one request per email, which sending again updates', async () => {
    const address = newAddress()
    const request = newRequest()
    expect(await requestToJoin(request, address)).toBe(204)
    expect(await requestToJoin({ ...request, email: request.email.toUpperCase(), note: 'And posts' }, address)).toBe(
      204,
    )
    expect(await storedRequest(request.email)).toEqual([{ name: request.name, note: 'And posts', invitedAt: null }])
    expect((await waitingList()).filter((each) => each.email === request.email)).toHaveLength(1)
  })

  it('answers the same for an email that has an account', async () => {
    const member = await addPerson([[workspace.id, 'editor']])
    expect(await requestToJoin({ ...newRequest(), email: member.email }, newAddress())).toBe(204)
  })

  it(`refuses the request after the ${REQUESTS_PER_WINDOW}th within the hour from one address, storing nothing`, async () => {
    const address = newAddress()
    for (let i = 0; i < REQUESTS_PER_WINDOW; i += 1) expect(await requestToJoin(newRequest(), address)).toBe(204)
    const sixth = newRequest()
    expect(await requestToJoin(sixth, address)).toBe(429)
    expect(await storedRequest(sixth.email)).toEqual([])
    // Another address is not held back.
    expect(await requestToJoin(newRequest(), newAddress())).toBe(204)
  })

  it('refuses a request whose Turnstile token Cloudflare doesn’t vouch for, storing nothing', async () => {
    const checked = earlyApp({ turnstile: siteverify('the-secret', siteverifyUrl) })
    const address = newAddress()
    const without = newRequest()
    expect(await requestToJoin(without, address, checked)).toBe(400)
    const bad = newRequest()
    expect(await requestToJoin({ ...bad, turnstileToken: 'bad-token' }, address, checked)).toBe(400)
    expect(await storedRequest(without.email)).toEqual([])
    expect(await storedRequest(bad.email)).toEqual([])

    const good = newRequest()
    expect(await requestToJoin({ ...good, turnstileToken: 'good-token' }, address, checked)).toBe(204)
    expect(await storedRequest(good.email)).toHaveLength(1)
    expect(verified.at(-1)?.get('remoteip')).toBe(address)
  })

  it('lets an admin invite a request, which sends a Dazbee invite and takes it off the list', async () => {
    const request = newRequest()
    await requestToJoin(request, newAddress())
    const [listed] = (await waitingList()).filter((each) => each.email === request.email)
    expect(listed).toMatchObject({ name: request.name, company: request.company, note: request.note })
    const sent = workos.made.invitations.length

    const invited = await ask(admin.token, 'POST', `/admin/access-requests/${listed?.id}/invite`)
    expect(invited.status).toBe(201)
    expect(DazbeeInvite.parse(invited.json).email).toBe(request.email)
    expect(workos.made.invitations.slice(sent)).toEqual([expect.objectContaining({ email: request.email })])
    expect((await storedRequest(request.email))[0]?.invitedAt).toBeInstanceOf(Date)
    expect((await waitingList()).map((each) => each.email)).not.toContain(request.email)
    const pending = DazbeeInvites.parse((await ask(admin.token, 'GET', '/admin/invites')).json).pending
    expect(pending.map((each) => each.email)).toContain(request.email)
  })

  it('lets an admin dismiss a request, which deletes it', async () => {
    const request = newRequest()
    await requestToJoin(request, newAddress())
    const [listed] = (await waitingList()).filter((each) => each.email === request.email)
    expect((await ask(admin.token, 'DELETE', `/admin/access-requests/${listed?.id}`)).status).toBe(204)
    expect(await storedRequest(request.email)).toEqual([])
    expect((await ask(admin.token, 'DELETE', `/admin/access-requests/${listed?.id}`)).status).toBe(404)
  })
})
