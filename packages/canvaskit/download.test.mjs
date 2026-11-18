import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'

import { download } from './download.mjs'

/** A local server that answers each request with the next of `answers`: a status code, or the file. */
async function serve(answers) {
  const seen = []
  const headers = []
  const server = createServer((request, response) => {
    const answer = answers[Math.min(seen.length, answers.length - 1)]
    seen.push(answer)
    headers.push(request.headers)
    if (answer === 'file') response.end('wasm bytes')
    else response.writeHead(answer).end()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}/canvaskit.wasm`
  return { url, seen, headers, close: () => new Promise((resolve) => server.close(resolve)) }
}

test('tries again after a server error and returns the file', async () => {
  const server = await serve([504, 502, 'file'])
  const bytes = await download(server.url, { wait: 1 })
  assert.equal(new TextDecoder().decode(bytes), 'wasm bytes')
  assert.equal(server.seen.length, 3)
  await server.close()
})

test('fails at once when the file is not there', async () => {
  const server = await serve([404])
  await assert.rejects(download(server.url, { wait: 1 }), /answered 404/)
  assert.equal(server.seen.length, 1)
  await server.close()
})

test('gives up after its last attempt', async () => {
  const server = await serve([504])
  await assert.rejects(download(server.url, { attempts: 3, wait: 1 }), /answered 504/)
  assert.equal(server.seen.length, 3)
  await server.close()
})

test('tries again when the server never answers', async () => {
  const hung = createServer(() => {})
  await new Promise((resolve) => hung.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${hung.address().port}/canvaskit.wasm`
  await assert.rejects(download(url, { attempts: 2, wait: 1, timeout: 200 }), /failed/)
  hung.closeAllConnections()
  await new Promise((resolve) => hung.close(resolve))
})

test('sends the headers it is given, as a private release asks', async () => {
  const server = await serve(['file'])
  try {
    await download(server.url, { headers: { authorization: 'Bearer t', accept: 'application/octet-stream' } })
    assert.equal(server.headers[0].authorization, 'Bearer t')
    assert.equal(server.headers[0].accept, 'application/octet-stream')
  } finally {
    await server.close()
  }
})
