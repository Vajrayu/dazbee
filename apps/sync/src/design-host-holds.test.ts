// The timing tests of a design's whole-design jobs at the limits (I9): opening it (parsing its rows,
// then replaying its journal), folding it (its state, then that state's JSON) and welcoming a tab with
// the whole design (the records, then their JSON). Each part runs in a turn of its own, so each is
// one hold of the event loop, measured as `holds.test.ts` in `packages/doc` measures a change set's:
// a ratio to a calibration loop (`JSON.parse` of a fixed 1 MiB), the best of 3 tries.
import { afterAll, describe, expect, it } from 'vitest'

import { appendRows, parseDesignRows, type RawDesignRows, readDesignRows } from '@dazbee/db'
import { firstSaved, type Loaded, openServer } from '@dazbee/doc/sync'
import { holdOf, watchHolds } from '@dazbee/doc/test-holds'
import { type DesignRecords, type Entry, SYNC_LIMITS } from '@dazbee/schema'

import { ANN, editor, hello, storeSaved } from './test-saves.ts'
import { closeDatabase, db } from './test-sync.ts'

afterAll(() => closeDatabase())

/**
 * The most each hold may take, as a multiple of the calibration loop: twice the most measured over
 * 6 runs on the machine that set them (read 5.0–5.9, parse 8.1–10.5, replay 15.3–19.1, save 1.1–1.6, state JSON
 * 4.9–5.2, records 1.4–1.6, welcome JSON 4.2–5.2), and at least 5. They catch a hold that grows.
 */
const CEILINGS = { read: 12, parse: 21, replay: 38, save: 5, stateJson: 11, records: 5, welcomeJson: 11 }
const TRIES = 3

const encoder = new TextEncoder()

/** A design at its limits: 1,000 pages, 5,000 frames, and in each frame a group of a text and a shape. */
function fullDesign(): DesignRecords {
  const box = { x: 10, y: 10, width: 400, height: 120 }
  const style = { fontFamily: 'Noto Sans', fontSize: 48, fontWeight: 700, color: '#111111FF' }
  const pages: Record<string, unknown> = {}
  const frames: Record<string, unknown> = {}
  const nodes: Record<string, unknown> = {}
  const framesPerPage = SYNC_LIMITS.designFrames / SYNC_LIMITS.designPages
  for (let p = 0; p < SYNC_LIMITS.designPages; p++) pages[`p${p}`] = { name: `Page ${p}`, order: `a${p}` }
  for (let f = 0; f < SYNC_LIMITS.designFrames; f++) {
    const pageId = `p${Math.floor(f / framesPerPage)}`
    frames[`f${f}`] = {
      pageId,
      name: `Size ${f}`,
      width: 1080,
      height: 1080,
      x: f * 1200,
      y: 0,
      fills: [],
      order: `a${f % 5}`,
    }
    nodes[`f${f}-group`] = { type: 'group', parentId: `f${f}`, link: 'group', index: 'a0', name: 'Group', props: box }
    nodes[`f${f}-text`] = {
      type: 'text',
      parentId: `f${f}-group`,
      link: 'headline',
      index: 'a0',
      name: 'Headline',
      props: { ...box, text: 'A summer sale headline, set in two runs', style, runs: [{ start: 0, end: 8, style }] },
    }
    nodes[`f${f}-shape`] = {
      type: 'graphic',
      parentId: `f${f}-group`,
      link: 'shape',
      index: 'a1',
      name: 'Shape',
      props: { ...box, shape: { kind: 'rect' }, fills: [{ type: 'solid', color: '#FF5A36FF' }] },
    }
  }
  return { meta: { designId: 'd', name: 'Full' }, pages, frames, nodes }
}

/** The rows of the full design with a journal of as many small change sets as a fold lets pile up. */
function fullRows(): RawDesignRows {
  const saved = firstSaved(fullDesign(), 'sync-full')
  const journal: Entry[] = [{ entry: 1, kind: 'issued', tabId: 1, member: ANN, secretHash: 'h', at: 0, dropped: [] }]
  for (let n = 1; n <= SYNC_LIMITS.foldEntries; n++) {
    const id = `f${n % SYNC_LIMITS.designFrames}-text`
    const changes = [{ op: 'set' as const, value: { part: 'layer' as const, id, key: 'name' }, to: `Edit ${n}` }]
    journal.push({
      entry: n + 1,
      kind: 'accepted',
      member: ANN,
      bytes: 120,
      changeSet: { seq: n, author: 1, changeSetId: n, changes },
    })
  }
  return {
    save: {
      designId: 'd',
      syncId: saved.syncId,
      entry: 0,
      seq: 0,
      lastEntry: journal.length,
      state: encoder.encode(JSON.stringify(saved.state)),
      placed: {},
      tabs: {},
      nextTabId: 1,
      versioned: 0,
      updatedAt: new Date(),
    },
    bodies: journal.map((e) => encoder.encode(JSON.stringify(e))),
  }
}

/** A fixed 1 MiB of JSON: the calibration loop parses it. */
function calibrationText(): string {
  const item = JSON.stringify({ id: 'abcdefgh', x: 12.5, y: 40, name: 'Calibration', on: true, tags: ['a', 'b'] })
  const items = Array.from({ length: Math.floor((1024 * 1024 - 2) / (item.length + 1)) }, () => item)
  return `[${items.join(',')}]`.padEnd(1024 * 1024, ' ')
}

/** The best of 3 holds of `run` (given what `before` makes, untimed), as a ratio to the calibration loop. */
function bestRatio<T>(before: () => T, run: (input: T) => void) {
  const text = calibrationText()
  let [ms, unit] = [Infinity, Infinity]
  run(before())
  for (let i = 0; i < TRIES; i++) {
    for (let j = 0; j < 5; j++)
      unit = Math.min(
        unit,
        holdOf(() => JSON.parse(text)),
      )
    const input = before()
    ms = Math.min(
      ms,
      holdOf(() => run(input)),
    )
  }
  return { ratio: ms / unit, ms, unit }
}

const options = { hashSecret: (s: string) => s }

describe('a design at the limits', () => {
  it('opens, folds and welcomes a tab, each part of each within its ceiling (I9)', () => {
    const raw = fullRows()
    const loaded: Loaded = parseDesignRows(raw)
    const server = openServer(structuredClone(loaded), options)
    expect(server.size()).toMatchObject({
      layers: SYNC_LIMITS.designLayers,
      frames: SYNC_LIMITS.designFrames,
      pages: SYNC_LIMITS.designPages,
    })
    expect(server.seq()).toBe(SYNC_LIMITS.foldEntries)
    const holds = {
      parse: bestRatio(
        () => raw,
        (rows) => parseDesignRows(rows),
      ),
      replay: bestRatio(
        () => structuredClone(loaded),
        (rows) => openServer(rows, options),
      ),
      save: bestRatio(
        () => server,
        (s) => s.save(),
      ),
      stateJson: bestRatio(
        () => server.save().state,
        (state) => encoder.encode(JSON.stringify(state)),
      ),
      records: bestRatio(
        () => server,
        (s) => s.join(hello(), editor()),
      ),
      welcomeJson: bestRatio(
        () => server.state().toRecords(),
        (records) => JSON.stringify(records),
      ),
    }
    console.info(
      Object.entries(holds)
        .map(([name, h]) => `${name} ${h.ms.toFixed(0)} ms = ${h.ratio.toFixed(1)} × ${h.unit.toFixed(2)} ms`)
        .join('; '),
    )
    for (const [name, hold] of Object.entries(holds)) {
      expect(hold.ratio, name).toBeLessThan(CEILINGS[name as keyof typeof CEILINGS])
    }
  }, 300_000)

  it('reads its rows from Postgres within the ceiling: the driver decodes the bytes off any turn (I9)', async () => {
    const raw = fullRows()
    const loaded = parseDesignRows(raw)
    const id = await storeSaved(loaded.saved.state)
    expect(await appendRows(db, id, loaded.journal, 0)).toBe('stored')
    const text = calibrationText()
    let unit = Infinity
    for (let j = 0; j < 5; j++)
      unit = Math.min(
        unit,
        holdOf(() => JSON.parse(text)),
      )
    let ms = Infinity
    for (let i = 0; i < TRIES; i++) {
      const stop = watchHolds()
      await readDesignRows(db, id)
      ms = Math.min(ms, stop())
    }
    console.info(`read ${ms.toFixed(0)} ms = ${(ms / unit).toFixed(1)} × ${unit.toFixed(2)} ms`)
    expect(ms / unit).toBeLessThan(CEILINGS.read)
  }, 120_000)
})
