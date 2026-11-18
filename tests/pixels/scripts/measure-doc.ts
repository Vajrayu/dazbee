// Measures the big carousel, cards × 5 linked frames, as the sync server holds it: the welcome a tab
// is sent and the state stored, how long opening and reading it take, and what one command costs on
// it. `node scripts/measure-doc.ts [cards]` (20 by default); pin it to one core with `taskset -c 0`
// to match the server.
import { gzipSync } from 'node:zlib'

import { openSession, readDesign } from '@dazbee/doc'
import { parseDesign } from '@dazbee/schema'

import { bigCarousel } from '../src/big-carousel.ts'
import { openWelcomed, welcomedStore, welcomeText } from '../src/welcomed.ts'

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0
const time = (run: () => void, times: number) =>
  median(
    Array.from({ length: times }, () => {
      const start = performance.now()
      run()
      return performance.now() - start
    }),
  )
const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`
const sized = (text: string) => `${kb(Buffer.byteLength(text))} (${kb(gzipSync(text).length)} gzipped)`

const cards = Number(process.argv[2] ?? 20)
const parsed = parseDesign(bigCarousel(cards))
if (!parsed.success) throw new Error(parsed.errors.join('\n'))
const design = parsed.design
console.log(
  `design: ${Object.keys(design.pages).length} pages, ${Object.keys(design.frames).length} frames, ${Object.keys(design.nodes).length} layers`,
)
console.log(`design JSON, as stored: ${sized(JSON.stringify(design))}`)
const welcome = welcomeText(design)
console.log(`welcome: ${sized(welcome)}`)
// Opening a design as a tab does: the sync client on the welcome, then the session's whole first read.
const open = time(() => openWelcomed(welcome).destroy(), 5)
console.log(`open (the client on the welcome, then a session's first read): ${open.toFixed(1)} ms median of 5`)

// A command checks its input against the session's design view, which only validates what
// changed since the last command (#23).
const store = welcomedStore(welcome)
console.log(`readDesign (the whole design as validated JSON): ${time(() => readDesign(store), 9).toFixed(1)} ms median`)
const session = openSession(store)
let x = 0
console.log(
  `one node.update command: ${time(() => session.run('node.update', { ids: ['p7-title'], patch: { x: x++ % 200 } }), 201).toFixed(2)} ms median`,
)
console.log(
  `one node.update command on a linked copy: ${time(() => session.run('node.update', { ids: ['p7-story-cta'], patch: { x: x++ % 200 } }), 201).toFixed(2)} ms median`,
)
console.log(
  `one text.edit command (a typed key): ${time(() => session.run('text.edit', { id: 'p7-body', op: { kind: 'insert', at: 0, text: 'a' } }), 201).toFixed(2)} ms median`,
)

// A working session: 1,000 more edits of the kinds people make, then the size again.
for (let i = 0; i < 1000; i++) {
  const card = `p${(i % Math.min(cards, 20)) + 1}`
  if (i % 3 === 0) session.run('text.edit', { id: `${card}-title`, op: { kind: 'insert', at: 0, text: 'N' } })
  else if (i % 3 === 1) session.run('text.edit', { id: `${card}-title`, op: { kind: 'delete', at: 0, length: 1 } })
  else session.run('node.update', { ids: [i % 2 ? `${card}-cta` : `${card}-story-cta`], patch: { x: 700 + (i % 50) } })
}
console.log(`design JSON after 1,000 more edits: ${sized(JSON.stringify(store.snapshot()))}`)
session.destroy()
