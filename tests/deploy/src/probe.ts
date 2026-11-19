// The deploy check's probe, which CI's images job runs on the production stack while deploy.sh swaps
// the apps. Every 100 ms it asks the web app (`/login`) and the API (`/health`) through Caddy, each on
// a new connection, and it holds one tab open on the sync server, on a design it stores for it. It
// says each request that failed and each close of the tab as it happens, and "the tab is open" once
// the tab is welcomed. On SIGTERM it says how many requests it made and failed, and exits 1 when any
// failed.
//
// Settings: DATABASE_URL and SYNC_TOKEN_SECRET as the sync server has them, and WEB_URL, API_URL and
// SYNC_URL, the addresses it asks through Caddy.
import { randomUUID } from 'node:crypto'
import { get as httpGet, type IncomingMessage } from 'node:http'
import { get as httpsGet } from 'node:https'

import { brands, createDesignSave, designs, openDatabase, workspaces } from '@dazbee/db'
import { firstSaved } from '@dazbee/doc/sync'
import { DESIGN_PARAM, type DesignRecords, PROTOCOL, SCHEMA_VERSION, TAB_VERSION_PARAM } from '@dazbee/schema'
import { signSyncToken } from '@dazbee/sync-token'

interface Count {
  made: number
  failed: number
}

const EVERY_MS = 100
const REQUEST_TIMEOUT_MS = 5000

const setting = (name: string) => {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set`)
  return value
}

const databaseUrl = setting('DATABASE_URL')
const secret = setting('SYNC_TOKEN_SECRET')
const targets = { web: `${setting('WEB_URL')}/login`, api: `${setting('API_URL')}/health` }
const syncUrl = setting('SYNC_URL')

const counts: Record<keyof typeof targets, Count> = { web: { made: 0, failed: 0 }, api: { made: 0, failed: 0 } }
const run = `deploy-check-${randomUUID().slice(0, 8)}`
const member = { workspaceId: `workspace-${run}`, userId: `user-${run}`, role: 'editor' as const, name: 'Probe' }

/** Says a line with the time, so it reads beside deploy.sh's. */
const say = (line: string) => console.log(`${new Date().toISOString().slice(11, 23)}  ${line}`)

/** Stores a design of one empty frame for the tab, as the API does at create; its id. */
async function storeDesign(): Promise<string> {
  const { db, close } = openDatabase(databaseUrl, { max: 1 })
  const designId = `design-${run}`
  const records: DesignRecords = {
    meta: { designId, name: 'Deploy check' },
    pages: { p1: { name: 'Page 1', order: 'a0' } },
    frames: { f: { pageId: 'p1', name: 'Square', width: 100, height: 100, x: 0, y: 0, fills: [], order: 'a0' } },
    nodes: {},
  }
  try {
    await db.insert(workspaces).values({ id: member.workspaceId, name: 'Deploy check' })
    await db.insert(brands).values({ id: `brand-${run}`, workspaceId: member.workspaceId, name: 'Deploy check' })
    await db.insert(designs).values({
      id: designId,
      workspaceId: member.workspaceId,
      brandId: `brand-${run}`,
      name: 'Deploy check',
      schemaVersion: SCHEMA_VERSION,
    })
    await createDesignSave(db, designId, firstSaved(records, `sync-${run}`))
  } finally {
    await close()
  }
  return designId
}

/** Asks `target` once on a new connection; counts a 200 as answered and anything else as failed. */
function ask(target: keyof typeof targets) {
  const url = targets[target]
  const count = counts[target]
  count.made++
  const failed = (why: string) => {
    count.failed++
    say(`${target}: ${url} failed: ${why}`)
  }
  const answered = (response: IncomingMessage) => {
    response.resume()
    if (response.statusCode !== 200) failed(`answered ${response.statusCode}`)
  }
  const request = (url.startsWith('https:') ? httpsGet : httpGet)(url, { agent: false }, answered)
  request.setTimeout(REQUEST_TIMEOUT_MS, () => request.destroy(new Error('no answer in time')))
  request.on('error', (error) => failed(error.message))
}

/** Opens a tab on the design and keeps it open, answering the server's token requests. */
function openTab(designId: string) {
  const token = () => signSyncToken(secret, { designId, ...member, schemaVersion: SCHEMA_VERSION }).token
  const params = new URLSearchParams({ [DESIGN_PARAM]: designId, [TAB_VERSION_PARAM]: String(SCHEMA_VERSION) })
  const socket = new WebSocket(`${syncUrl}/?${params}`)
  socket.addEventListener('open', () =>
    socket.send(JSON.stringify({ type: 'hello', protocol: PROTOCOL, token: token(), waiting: 0 })),
  )
  socket.addEventListener('message', (event) => {
    if (typeof event.data !== 'string') return
    const message = JSON.parse(event.data) as { type: string }
    if (message.type === 'welcome') say('the tab is open')
    if (message.type === 'token') socket.send(JSON.stringify({ type: 'token', token: token() }))
  })
  socket.addEventListener('close', (event) => say(`the tab closed with ${event.code}`))
}

const designId = await storeDesign()
openTab(designId)
const asking = setInterval(() => {
  ask('web')
  ask('api')
}, EVERY_MS)

process.once('SIGTERM', () => {
  clearInterval(asking)
  // Requests still out get their time to answer.
  setTimeout(() => {
    for (const [target, { made, failed }] of Object.entries(counts))
      say(`${target}: ${made} requests, ${failed} failed`)
    process.exit(counts.web.failed + counts.api.failed > 0 ? 1 : 0)
  }, REQUEST_TIMEOUT_MS + 500)
})
