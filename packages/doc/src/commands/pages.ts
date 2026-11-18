import { z } from 'zod'

import {
  type Design,
  Frame,
  FrameId,
  framesOf,
  inOrder,
  NEW_FRAME_FILLS,
  Page,
  PageId,
  sizeProblem,
} from '@dazbee/schema'

import type { StoreWrite } from '../store.ts'
import { idProblem, pageProblem } from './checks.ts'
import { defineCommand } from './define.ts'
import { deleteFrame, FrameName } from './frames.ts'
import { copyFrameLayers, orderIndexes, type Slot, writeOrder } from './tree.ts'

/**
 * Adds a page after the last one, holding one empty white frame at 0, 0 of the given name and
 * size: the caller passes those of the frame the user is on. Returns the page's id.
 */
export const pageAdd = defineCommand({
  name: 'page.add',
  description:
    'Adds a page after the last one, holding one empty white frame, and returns the page’s id. It refuses an id already in use and a frame size the editor does not take.',
  step: 'addPage',
  input: z.strictObject({
    id: PageId.optional().describe('The new page’s id; a fresh one is made when left out.'),
    name: z.string().describe('The page’s name.'),
    frame: z
      .strictObject({
        id: FrameId.optional().describe('The frame’s id; a fresh one is made when left out.'),
        name: FrameName.describe('The frame’s name.'),
        width: Frame.shape.width.describe('Its width, in pixels.'),
        height: Frame.shape.height.describe('Its height, in pixels.'),
      })
      .describe('The frame the page starts with: an optional id, its name, and its width and height in pixels.'),
  }),
  check: (ctx, { id, frame }) =>
    idProblem(ctx, id) ??
    idProblem(ctx, frame.id) ??
    (id !== undefined && id === frame.id ? `id "${id}" is taken` : undefined) ??
    sizeProblem(frame.width, frame.height),
  apply: ({ w, design, newId }, { id = newId(), name, frame: { id: frameId = newId(), ...frame } }) => {
    writeRepairedPages(w, design)
    const orderOf = writeOrder(w, 'page', [...pageSlots(design), [id, null]], new Set([id]))
    const page: Page = { name, order: orderOf(id) }
    w.create('page', id, page)
    const first = writeOrder(w, 'frame', [[frameId, null]], new Set([frameId]))
    const added: Frame = { ...frame, pageId: id, x: 0, y: 0, fills: NEW_FRAME_FILLS, order: first(frameId) }
    w.create('frame', frameId, added)
    return id
  },
})

/** Renames a page. */
export const pageUpdate = defineCommand({
  name: 'page.update',
  description: 'Renames a page. It refuses a missing page.',
  step: 'renamePage',
  batchable: true,
  input: z.strictObject({
    id: PageId.describe('The page to rename.'),
    name: z.string().optional().describe('Its new name; it keeps its name when left out.'),
  }),
  check: ({ design }, { id }) => pageProblem(design, id),
  apply: ({ w, design }, { id, name }) => {
    writeRepairedPages(w, design)
    if (name !== undefined) w.set('page', id, 'name', name)
  },
})

/**
 * Copies a page right after itself, with each of its frames (new ids, the same name, size, place,
 * fills and order) and every layer in them with a fresh id. The copies get one new link id per
 * old one, so the copied frames stay linked to each other and to nothing on the page they came
 * from. Returns the new page's id.
 */
export const pageDuplicate = defineCommand({
  name: 'page.duplicate',
  description:
    'Copies a page right after itself, with its frames and every layer in them, the copied frames linked to each other and not to the page they came from, and returns the new page’s id. It refuses a missing page and an id already in use.',
  step: 'duplicatePage',
  input: z.strictObject({
    id: PageId.describe('The page to copy.'),
    newId: PageId.optional().describe('The copy’s id; a fresh one is made when left out.'),
    name: z.string().optional().describe('The copy’s name; the same as the page’s when left out.'),
  }),
  check: (ctx, { id, newId }) => pageProblem(ctx.design, id) ?? idProblem(ctx, newId),
  apply: (ctx, { id, newId = ctx.newId(), name }) => {
    const { w, design } = ctx
    const page = design.pages[id]
    if (!page) return newId
    writeRepairedPages(w, design)
    const pages = pageSlots(design)
    const after = pages.findIndex(([other]) => other === id) + 1
    const orderOf = writeOrder(w, 'page', pages.toSpliced(after, 0, [newId, null]), new Set([newId]))
    const copied: Page = { ...page, name: name ?? page.name, order: orderOf(newId) }
    w.create('page', newId, copied)
    const links = new Map<string, string>()
    const frames = framesOf(design, id)
    // Frames with one order are drawn in id order, and a copy has another id: each copy gets an order of its own.
    const orders = orderIndexes(frames.map(([frameId, frame]) => [frameId, frame.order]))
    for (const [frameId, frame] of frames) {
      const copy = ctx.newId()
      const frameCopy: Frame = { ...frame, pageId: newId, order: orders.get(frameId) ?? frame.order }
      w.create('frame', copy, frameCopy)
      copyFrameLayers(ctx, frameId, copy, { links })
    }
    return newId
  },
})

/** Moves a page ahead of another page, or to the end with null. */
export const pageMove = defineCommand({
  name: 'page.move',
  description:
    'Moves a page ahead of another page, or to the end. It refuses a missing page, and the page itself to go before.',
  step: 'movePage',
  input: z.strictObject({
    id: PageId.describe('The page to move.'),
    before: PageId.nullable().describe('The page it goes ahead of, or null for the end.'),
  }),
  check: ({ design }, { id, before }) => {
    const problem = pageProblem(design, id)
    if (problem) return problem
    if (before && (before === id || pageProblem(design, before))) return `no other page "${before}" to go before`
    return undefined
  },
  apply: ({ w, design }, { id, before }) => {
    writeRepairedPages(w, design)
    const others = pageSlots(design).filter(([other]) => other !== id)
    const at = before === null ? others.length : others.findIndex(([other]) => other === before)
    writeOrder(w, 'page', others.toSpliced(at, 0, [id, design.pages[id]?.order ?? null]), new Set([id]))
  },
})

/** Deletes a page, its frames and their layers; undo brings them back. A design keeps at least one page. */
export const pageDelete = defineCommand({
  name: 'page.delete',
  description: 'Deletes a page, its frames and their layers. It refuses a missing page and the only page of a design.',
  step: 'deletePage',
  input: z.strictObject({ id: PageId.describe('The page to delete.') }),
  check: ({ design }, { id }) => {
    const problem = pageProblem(design, id)
    if (problem) return problem
    if (Object.keys(design.pages).length === 1) return 'a design keeps at least one page'
    return undefined
  },
  apply: ({ w, design }, { id }) => {
    for (const [frameId] of framesOf(design, id)) deleteFrame(w, design, frameId)
    w.remove('page', id)
  },
})

/** A design's pages as slots, in order. */
function pageSlots(design: Design): Slot[] {
  return inOrder(design.pages).map(([id, page]) => [id, page.order])
}

/**
 * Writes the page repair adds to a design whose last pages two tabs deleted at once, so a page
 * edit lands on a page the document holds, and adding a page keeps that one.
 */
function writeRepairedPages(w: StoreWrite, design: Design) {
  for (const [id, page] of Object.entries(design.pages)) if (!w.has('page', id)) w.create('page', id, page)
}
