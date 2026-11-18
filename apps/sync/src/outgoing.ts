// What the sync server sends a tab, as socket data (D10): a message's JSON as text, or, past 1 MiB,
// gzipped off the event loop and sent as binary. A welcome that carries the whole design is written
// with the design last, its JSON kept for the design's sequence number, so the tabs joining at one
// sequence number write it once; writing it afresh is a whole-design job, in a turn of its own.
// A version a tab asked for is written with its stored records' JSON unparsed (`versionText`), in a
// turn of its own as a whole-design welcome is.
// What goes to one tab goes out in the order it was made, a gzip in flight holding what follows.
import { promisify } from 'node:util'
import { gzip } from 'node:zlib'

import { type VersionAnswer, versionText } from '@dazbee/doc/sync'
import type { DesignRecords, ServerMessage } from '@dazbee/schema'

/** What a socket sends: text, or a gzipped message as binary. */
export type Data = string | Uint8Array

/** The design JSON of the latest whole-design welcome, kept per design and dropped with it. */
export interface WelcomeCache {
  key?: string
  json?: string
}

/** Past this many bytes, a message is gzipped. */
export const GZIP_BYTES = 1024 * 1024

const gzipped = promisify(gzip)

/**
 * `message` as socket data: at once, or later when its design's JSON must be written (after `turn`)
 * or it is gzipped.
 */
export function encode(
  message: ServerMessage | VersionAnswer,
  cache: WelcomeCache,
  turn: () => Promise<void>,
): Data | Promise<Data> {
  if (message.type === 'storedVersion') {
    return message.stored ? turn().then(() => finish(versionText(message))) : finish(versionText(message))
  }
  if (message.type !== 'welcome' || !('design' in message.catchUp)) return finish(JSON.stringify(message))
  const { catchUp, ...head } = message
  const { design } = catchUp
  // The design at this sequence number of this sync id: a drop takes a new cache, so a number reused
  // for other changes after a failed write never meets the old JSON.
  const key = `${message.syncId}:${message.seq}`
  const write = (json: string) => finish(`${JSON.stringify(head).slice(0, -1)},"catchUp":{"design":${json}}}`)
  if (cache.key === key && cache.json !== undefined) return write(cache.json)
  return turn().then(() => {
    const json = designJson(design, cache, key)
    return write(json)
  })
}

/**
 * Sends data to one socket in the order it was made: data still being made holds what comes after
 * it. `failed` hears data that could not be made. Each call gives what is still to send, if anything.
 */
export function inOrder<T = Data>(
  send: (data: T) => void,
  failed: (error: unknown) => void,
): (data: T | Promise<T>) => Promise<void> | undefined {
  let last: Promise<void> | undefined
  return (data) => {
    if (last === undefined && !(data instanceof Promise)) {
      send(data)
      return undefined
    }
    const next = Promise.all([last, data])
      .then(([, ready]) => send(ready))
      .catch(failed)
    last = next
    void next.then(() => {
      if (last === next) last = undefined
    })
    return next
  }
}

/** The text, or its gzip past `GZIP_BYTES`. */
function finish(text: string): Data | Promise<Data> {
  if (Buffer.byteLength(text) <= GZIP_BYTES) return text
  return gzipped(text).then((zipped) => new Uint8Array(zipped.buffer, zipped.byteOffset, zipped.byteLength))
}

/** The design's JSON at `key`, from the cache or written now and kept. */
function designJson(design: DesignRecords, cache: WelcomeCache, key: string): string {
  if (cache.key === key && cache.json !== undefined) return cache.json
  cache.key = key
  cache.json = JSON.stringify(design)
  return cache.json
}
