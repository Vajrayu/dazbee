// What both sync servers run their WebSockets in: an HTTP server that answers a plain request to say
// it is up, and takes each WebSocket upgrade whose target reads as a URL, refusing a frame over
// `maxPayload` before buffering it (1009).
import { createServer } from 'node:http'

import { type RawData, type WebSocket, WebSocketServer } from 'ws'

/** The WebSocket server: where it listens, and closing every socket. */
export interface Sockets {
  httpServer: ReturnType<typeof createServer>
  listen(): Promise<void>
  /** Stops taking WebSockets and ends every open one at once. */
  close(): void
}

/** Serves WebSockets on `port`, handing each to `open` with the request its upgrade made. */
export function socketShell(
  port: number,
  maxPayload: number,
  open: (socket: WebSocket, request: Request) => void,
): Sockets {
  // A plain HTTP request is answered only to say the server is up, as health checks ask.
  const httpServer = createServer((_, response) => response.writeHead(200, { 'content-type': 'text/plain' }).end('up'))
  const sockets = new WebSocketServer({ noServer: true, maxPayload })
  // An error on either is logged; neither may stop the process.
  httpServer.on('error', (error) => console.error('sync HTTP server error', error))
  sockets.on('error', (error) => console.error('sync WebSocket server error', error))
  httpServer.on('upgrade', (incoming, stream, head) => {
    // Only the target's query is read, against a fixed origin: the Host header is the client's to
    // write. A target that is no URL is refused.
    let request: Request
    try {
      request = new Request(new URL(incoming.url ?? '/', 'http://sync.invalid'))
    } catch {
      stream.destroy()
      return
    }
    sockets.handleUpgrade(incoming, stream, head, (socket) => open(socket, request))
  })
  return {
    httpServer,
    listen: () => new Promise((resolve) => httpServer.listen(port, resolve)),
    close() {
      httpServer.close()
      for (const socket of sockets.clients) socket.terminate()
    },
  }
}

/** A frame's bytes, however `ws` gave them. */
export function bytesOf(data: RawData): Uint8Array {
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  const buffer = Array.isArray(data) ? Buffer.concat(data) : data
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
}
