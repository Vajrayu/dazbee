// The timing tests of a change set's parse and accept at the limits (I9, G7): the worst change sets
// the caps allow hold the event loop no longer than their ceilings. They are a paste of a design's
// every page, frame and layer, its undo, and an undo of the most changes a change set may hold,
// spread over a full design. Each hold is measured as a ratio to a calibration loop run in the same
// test (`JSON.parse` of a fixed 1 MiB string), the best of 3 tries, so that a slower machine moves
// both alike.
import { describe, expect, it } from 'vitest'

import { type Change, type DesignRecords, SYNC_LIMITS, TabMessage } from '@dazbee/schema'

import { holdOf } from '../test-holds.ts'
import { capIssue, changeSetIssue, designBytes } from './checks.ts'
import { DesignState } from './state.ts'

/**
 * The most each hold may take, as a multiple of the calibration loop: twice the most measured over
 * 10 runs on the machine that set them (paste 31–58, undo 4–11, sets 43–64; the PR gives the
 * numbers), since one shared machine's best of 3 still moves by half. They catch a hold that grows;
 * the spec's budget is checked against them by hand when they are set.
 */
const CEILINGS = { paste: 115, undo: 22, sets: 130 }
const TRIES = 3

/** A design with one page and nothing on it: the change sets below fill it to its limits. */
const emptyDesign = (): DesignRecords => ({
  meta: { designId: 'd1', name: 'Full' },
  pages: { p0: { name: 'Page', order: 'a0' } },
  frames: {},
  nodes: {},
})

/**
 * The creates that fill the empty design to its limits: every page but its first, five frames on
 * each page, and in each frame a group of a text and a shape. Each frame's layers share their links
 * with every other frame, as a design's sizes do.
 */
function fullPaste(): Change[] {
  const changes: Change[] = []
  const box = { x: 10, y: 10, width: 400, height: 120 }
  const style = { fontFamily: 'Noto Sans', fontSize: 48, fontWeight: 700, color: '#111111FF' }
  const framesPerPage = SYNC_LIMITS.designFrames / SYNC_LIMITS.designPages
  for (let p = 1; p < SYNC_LIMITS.designPages; p++) {
    changes.push({ op: 'create', part: 'page', id: `p${p}`, record: { name: `Page ${p}`, order: `a${p}` } })
  }
  for (let f = 0; f < SYNC_LIMITS.designFrames; f++) {
    const pageId = `p${Math.floor(f / framesPerPage)}`
    const frame = { pageId, name: `Size ${f}`, width: 1080, height: 1080, x: f * 1200, y: 0, order: `a${f % 5}` }
    changes.push({ op: 'create', part: 'frame', id: `f${f}`, record: frame })
    changes.push({
      op: 'create',
      part: 'layer',
      id: `f${f}-group`,
      record: { type: 'group', parentId: `f${f}`, link: 'group', index: 'a0', name: 'Group', props: box },
    })
    changes.push({
      op: 'create',
      part: 'layer',
      id: `f${f}-text`,
      record: {
        type: 'text',
        parentId: `f${f}-group`,
        link: 'headline',
        index: 'a0',
        name: 'Headline',
        props: { ...box, text: 'A summer sale headline, set in two runs', style, runs: [{ start: 0, end: 8, style }] },
      },
    })
    changes.push({
      op: 'create',
      part: 'layer',
      id: `f${f}-shape`,
      record: {
        type: 'graphic',
        parentId: `f${f}-group`,
        link: 'shape',
        index: 'a1',
        name: 'Shape',
        props: { ...box, shape: { kind: 'rect' }, fills: [{ type: 'solid', color: '#FF5A36FF' }] },
      },
    })
  }
  return changes
}

/** The paste's undo, as a step's change set has it: one delete per page it made. */
function fullUndo(): Change[] {
  return Array.from({ length: SYNC_LIMITS.designPages - 1 }, (_, p) => ({
    op: 'delete',
    part: 'page',
    id: `p${p + 1}`,
  }))
}

/**
 * An undo that sets back four values of every layer of the full design: the most changes a change
 * set may hold, spread over the most records.
 */
function fullSets(): Change[] {
  const changes: Change[] = []
  for (let f = 0; f < SYNC_LIMITS.designFrames; f++) {
    for (const layer of [`f${f}-group`, `f${f}-text`, `f${f}-shape`]) {
      for (const prop of ['x', 'y', 'width', 'height']) {
        changes.push({ op: 'set', value: { part: 'layer', id: layer, key: 'props', prop }, to: 20 })
      }
    }
  }
  return changes
}

/** The message a tab sends for a change set, as text. */
function message(changes: Change[]): string {
  return JSON.stringify({ type: 'changes', id: 1, base: 0, kind: 'edit', changes })
}

/** Parses a change set's message and accepts it on `state`, as the server does: caps, apply, checks, commit. */
function parseAndAccept(state: DesignState, text: string) {
  const parsed = TabMessage.parse(JSON.parse(text))
  if (parsed.type !== 'changes') throw new Error('not a change set')
  const cap = capIssue(parsed.changes)
  if (cap) throw new Error(cap.words)
  const after = state.overlay(true)
  const written = new Set<string>()
  for (const change of parsed.changes) for (const key of after.apply(change, 'strict')) written.add(key)
  const issue = changeSetIssue(after, state, written)
  if (issue) throw new Error(issue.words)
  after.commit({ seq: 1, author: 1 })
}

/** A fixed 1 MiB of JSON: the calibration loop parses it. */
function calibrationText(): string {
  const item = JSON.stringify({ id: 'abcdefgh', x: 12.5, y: 40, name: 'Calibration', on: true, tags: ['a', 'b'] })
  const items = Array.from({ length: Math.floor((1024 * 1024 - 2) / (item.length + 1)) }, () => item)
  return `[${items.join(',')}]`.padEnd(1024 * 1024, ' ')
}

/**
 * The hold of `run` on a fresh state from `design`, as a ratio to the calibration loop: the best
 * of 3 tries over the fastest calibration, measured before each try, so that neither a slow try
 * nor a slow calibration counts.
 */
function bestRatio(design: () => DesignRecords, run: (state: DesignState) => void) {
  const text = calibrationText()
  let [ms, unit] = [Infinity, Infinity]
  // A first run untimed, so the tries measure code the engine has compiled, as a server's is.
  run(DesignState.fromRecords(design()))
  for (let i = 0; i < TRIES; i++) {
    for (let j = 0; j < 5; j++)
      unit = Math.min(
        unit,
        holdOf(() => JSON.parse(text)),
      )
    const state = DesignState.fromRecords(design())
    ms = Math.min(
      ms,
      holdOf(() => run(state)),
    )
  }
  return { ratio: ms / unit, ms, unit }
}

describe('a change set at the limits', () => {
  it('parses and accepts within its ceiling: a paste of a full design, its undo, and the most sets (I9)', () => {
    const paste = message(fullPaste())
    const undo = message(fullUndo())
    const sets = message(fullSets())
    const full = () => {
      const state = DesignState.fromRecords(emptyDesign())
      parseAndAccept(state, paste)
      return state.toRecords()
    }
    // The paste fills the design to its limits, and its message fits one.
    const filled = DesignState.fromRecords(full())
    expect([filled.count('page'), filled.count('frame'), filled.count('layer')]).toEqual([
      SYNC_LIMITS.designPages,
      SYNC_LIMITS.designFrames,
      SYNC_LIMITS.designLayers,
    ])
    expect(designBytes(filled)).toBeLessThan(SYNC_LIMITS.designBytes)
    expect(paste.length).toBeLessThan(SYNC_LIMITS.messageBytes)

    const holds = {
      paste: bestRatio(emptyDesign, (state) => parseAndAccept(state, paste)),
      undo: bestRatio(full, (state) => parseAndAccept(state, undo)),
      sets: bestRatio(full, (state) => parseAndAccept(state, sets)),
    }
    console.info(
      Object.entries(holds)
        .map(([name, h]) => `${name} ${h.ms.toFixed(0)} ms = ${h.ratio.toFixed(1)} × ${h.unit.toFixed(2)} ms`)
        .join('; '),
    )
    for (const [name, hold] of Object.entries(holds)) {
      expect(hold.ratio, name).toBeLessThan(CEILINGS[name as keyof typeof CEILINGS])
    }
  }, 120_000)
})
