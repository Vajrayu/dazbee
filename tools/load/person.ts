// One simulated person, as a browser tab on their design runs the editor: they open the design (timed
// from loading the design page, through a sync token from its server action, to the sync server's
// welcome on the sync client, `openClient`), move its frame every 2 s, and now and then load the
// Brands page or upload an image. Each is timed into the step that is running when it starts. A failure, or the sync server closing the
// tab, counts as a failure of the step running then, and its reason is told to `onFailure`.
import { type Client, openClient } from '@dazbee/doc'
import { DESIGN_PARAM, PROTOCOL, SCHEMA_VERSION, type ServerMessage, TAB_VERSION_PARAM } from '@dazbee/schema'

import type { LoadPerson } from './load-workspace.ts'
import { noisePng } from './noise-png.ts'
import type { Measure, stepTimings } from './timings.ts'
import type { WebApp } from './web-app.ts'

export type StepTimings = ReturnType<typeof stepTimings>

export interface PersonOptions {
  person: LoadPerson
  web: WebApp
  syncUrl: string
  /** The timings of the step running now. */
  timings: () => StepTimings
  /** Told why each failure happened. */
  onFailure: (what: Measure, why: string) => void
}

/** How often a person edits. */
const EDIT_EVERY_MS = 2000

/** How long a tab waits for the sync server's welcome before its open counts as failed. */
const WELCOME_TIMEOUT_MS = 30_000

/** The side of the image each upload sends: 160 px of random RGB, about 77 KB. */
const UPLOAD_SIDE = 160

/** Opens a person's design and keeps them editing until `close`. */
export function simulatedPerson({ person, web, syncUrl, timings, onFailure }: PersonOptions) {
  /** The tab's socket, once opened. */
  let socket: WebSocket | undefined
  /** The tab's sync client, once welcomed. */
  let client: Client | undefined
  /** Each sent change set still unanswered, by its id. */
  const editing = new Map<number, { done(): void; failed(): void }>()
  /** Whether `close` was called, so the socket's close is no failure. */
  let closing = false
  /** How many edits were made: the frame's x moves between 40 and 0, starting at 0. */
  let edits = 0
  /** The timer that edits every 2 s, once welcomed. */
  let editTimer: ReturnType<typeof setInterval> | undefined

  /** Opens the design and, once welcomed, starts editing every 2 s. Resolves once welcomed or failed. */
  async function open(): Promise<void> {
    const timing = timings().start('open')
    try {
      await web.designPage()
      const token = await web.syncToken()
      await connect(token)
      timing.done()
      editTimer = setInterval(edit, EDIT_EVERY_MS)
    } catch (error) {
      timing.failed()
      onFailure('open', String(error))
    }
  }

  /** Opens the socket and resolves on the welcome; rejects on a close before it. */
  function connect(token: string): Promise<void> {
    const params = new URLSearchParams({ [DESIGN_PARAM]: person.designId, [TAB_VERSION_PARAM]: String(SCHEMA_VERSION) })
    const ws = new WebSocket(`${syncUrl}/?${params}`)
    socket = ws
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`no welcome in ${WELCOME_TIMEOUT_MS / 1000} s`))
        ws.close()
      }, WELCOME_TIMEOUT_MS)
      ws.addEventListener('open', () => send({ type: 'hello', protocol: PROTOCOL, token, waiting: 0 }))
      ws.addEventListener('message', (event) => {
        if (typeof event.data !== 'string') return
        const message = JSON.parse(event.data) as ServerMessage
        if (!client) {
          if (message.type !== 'welcome') return
          clearTimeout(timeout)
          client = openClient(message, { onTokenRequest: renewToken })
          return resolve()
        }
        heard(client, message)
      })
      ws.addEventListener('close', (event) => {
        clearTimeout(timeout)
        clearInterval(editTimer)
        // The edits in flight fail with the tab; with none in flight, the close itself is the failure.
        const inFlight = editing.size
        for (const timing of editing.values()) timing.failed()
        editing.clear()
        if (closing) return
        const why = `the sync server closed the tab with ${event.code} ${event.reason}`
        if (!client) return reject(new Error(why))
        if (inFlight === 0) timings().failure('edit')
        onFailure('edit', why)
      })
    })
  }

  /** Passes a server message to the client, sends its answers, and times the tab's own change sets. */
  function heard(tab: Client, message: ServerMessage) {
    let replies
    try {
      replies = tab.receive(message)
    } catch (error) {
      timings().failure('edit')
      onFailure('edit', `the sync client could not go on: ${String(error)}`)
      return close()
    }
    replies.forEach(send)
    if (message.type === 'accepted' && message.author === tab.tabId()) {
      editing.get(message.changeSetId)?.done()
      editing.delete(message.changeSetId)
    }
    if (message.type === 'reject') {
      editing.get(message.changeSetId)?.failed()
      editing.delete(message.changeSetId)
      onFailure('edit', `the sync server rejected an edit: ${message.reason}`)
    }
  }

  /** Moves the frame as one step, and times its change set until the server accepts it. */
  function edit() {
    if (!client || socket?.readyState !== WebSocket.OPEN) return
    client.open()
    client.write({ op: 'set', value: { part: 'frame', id: person.frameId, key: 'x' }, to: (++edits % 2) * 40 })
    for (const message of client.end('Move')) {
      if (message.type === 'changes') editing.set(message.id, timings().start('edit'))
      send(message)
    }
  }

  /** Sends the sync server the fresh token it asked for, as the editor does. */
  function renewToken() {
    web.syncToken().then(
      (token) => send({ type: 'token', token }),
      (error: unknown) => {
        timings().failure('edit')
        onFailure('edit', `no fresh sync token: ${String(error)}`)
      },
    )
  }

  /** Loads the Brands page, timed. */
  async function brandsPage() {
    const timing = timings().start('brands')
    try {
      await web.brandsPage()
      timing.done()
    } catch (error) {
      timing.failed()
      onFailure('brands', String(error))
    }
  }

  /** Uploads a new image, timed. */
  async function upload() {
    const timing = timings().start('upload')
    try {
      await web.upload(noisePng(UPLOAD_SIDE, UPLOAD_SIDE))
      timing.done()
    } catch (error) {
      timing.failed()
      onFailure('upload', String(error))
    }
  }

  function send(message: unknown) {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
  }

  function close() {
    closing = true
    clearInterval(editTimer)
    socket?.close()
  }

  return { open, brandsPage, upload, close }
}
