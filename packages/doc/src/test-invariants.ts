// The rules every design holds after any command, fault, refusal, sync or repair, which every doc
// test checks through its sessions (test-design.ts).
import { expect } from 'vitest'

import { checkStructure, type Design } from '@dazbee/schema'

import { childrenOf } from './children.ts'
import { repair } from './repair.ts'
import type { Session } from './session.ts'
import { type DesignStore, readDesign } from './store.ts'

/**
 * The rules every design holds after any command, sync or repair, broken ones as `path: message`,
 * as the schema checks a design's shape (checkStructure); empty when they hold: it has a page,
 * every layer's chain of parents ends at a frame that exists, on a page that exists, and no frame
 * holds two layers with one link id.
 */
export function brokenInvariants(design: Design): string[] {
  const broken: string[] = []
  checkStructure(design, (path, message) => broken.push(`${path.join('.')}: ${message}`))
  return broken
}

/** Fails the test with the broken rules. */
export function expectInvariants(design: Design): void {
  expect(brokenInvariants(design), 'broken invariants').toEqual([])
}

/**
 * What is wrong with the document as it is stored, in words; empty when nothing is: what a read
 * of it repairs or leaves out, and each number in it that is NaN or infinite, as `path: number`.
 * A command, a fault or a refusal on a document with nothing wrong leaves one with nothing wrong:
 * repair is for what concurrent edits break, never for what a command writes.
 */
export function brokenDocument(store: DesignStore): string[] {
  const stored = store.snapshot()
  const { repairs, leftOut } = repair(stored)
  const broken = [...repairs, ...leftOut.map(({ part, id, issue }) => `left out ${part} "${id}": ${issue}`)]
  const look = (value: unknown, path: string) => {
    if (typeof value === 'number' && !Number.isFinite(value)) broken.push(`${path}: ${value}`)
    if (typeof value === 'object' && value !== null)
      for (const [key, inner] of Object.entries(value)) look(inner, `${path}.${key}`)
  }
  for (const [part, value] of Object.entries(stored)) look(value, part)
  return broken
}

/**
 * The parents a change put a layer into, or moved one within, whose layers' indexes are not all
 * distinct after it, in words; empty when each such parent's are. `before` is the layers before
 * the change.
 */
export function tiedIndexes(before: Design['nodes'], after: Design): string[] {
  const touched = new Set<string>()
  for (const [id, layer] of Object.entries(after.nodes)) {
    const was = before[id]
    if (!was || was.parentId !== layer.parentId || was.index !== layer.index) touched.add(layer.parentId)
  }
  const tied: string[] = []
  for (const parentId of touched) {
    const indexes = Object.values(after.nodes)
      .filter((layer) => layer.parentId === parentId)
      .map((layer) => layer.index)
    for (const index of new Set(indexes.filter((index, i) => indexes.indexOf(index) !== i)))
      tied.push(`${parentId}: layers share the index "${index}"`)
  }
  return tied
}

/** A session's live design equals a full read of its store, layer order under every parent included. */
export function expectFullRead(tab: Session, store: DesignStore) {
  const full = readDesign(store)
  const view = tab.design()
  expect(view).toEqual(full)
  const order = (design: Design) =>
    Object.fromEntries(
      [...Object.keys(design.frames), ...Object.keys(design.nodes)].map((id) => [
        id,
        childrenOf(design, id).map(([child]) => child),
      ]),
    )
  expect(order(view)).toEqual(order(full))
}
