// Commands on a frame's guides: add one, move one, remove one, remove them all. Each writes the
// frame's whole list of guides as one value.
import { z } from 'zod'

import { type Design, type Frame, FrameId, Guide, MAX_GUIDES } from '@dazbee/schema'

import type { StoreWrite } from '../store.ts'
import { frameProblem } from './checks.ts'
import { defineCommand } from './define.ts'

/** Where a guide sits in its frame's list of guides. */
const GuideIndex = z.number().int().min(0)

/** Adds a guide after the frame's others. Returns its index in the frame's guides. */
export const guideAdd = defineCommand({
  name: 'guide.add',
  description:
    'Adds a guide to a frame, after its others, and returns its index. It refuses a missing frame, a place off the frame and a frame that holds the most guides already.',
  step: 'addGuide',
  input: z.strictObject({
    frameId: FrameId.describe('The frame the guide goes in.'),
    axis: Guide.shape.axis.describe('x for a vertical guide, y for a horizontal one.'),
    at: Guide.shape.at.describe('Where it goes: its x or y in the frame, in whole pixels from 0 to the frame’s side.'),
  }),
  check: ({ design }, { frameId, axis, at }) => {
    const problem = frameProblem(design, frameId)
    if (problem) return problem
    const frame = design.frames[frameId] as Frame
    if (guidesOf(design, frameId).length >= MAX_GUIDES) return `frame "${frameId}" holds ${MAX_GUIDES} guides already`
    return placeProblem(frame, axis, at)
  },
  apply: ({ w, design }, { frameId, axis, at }) => {
    const next = [...guidesOf(design, frameId), { axis, at }]
    writeGuides(w, frameId, next)
    return next.length - 1
  },
})

/** Moves one of a frame's guides along its axis, to another place in the frame. */
export const guideMove = defineCommand({
  name: 'guide.move',
  description:
    'Moves one of a frame’s guides along its axis. It refuses a missing frame, an index the frame has no guide at and a place off the frame.',
  step: 'moveGuide',
  input: z.strictObject({
    frameId: FrameId.describe('The frame the guide is in.'),
    index: GuideIndex.describe('The guide’s index in the frame’s guides.'),
    at: Guide.shape.at.describe('Its new x or y in the frame, in whole pixels from 0 to the frame’s side.'),
  }),
  check: ({ design }, { frameId, index, at }) => {
    const problem = guideProblem(design, frameId, index)
    if (problem) return problem
    const guide = guidesOf(design, frameId)[index] as Guide
    return placeProblem(design.frames[frameId] as Frame, guide.axis, at)
  },
  apply: ({ w, design }, { frameId, index, at }) => {
    const next = guidesOf(design, frameId).map((guide, i) => (i === index ? { ...guide, at } : guide))
    writeGuides(w, frameId, next)
  },
})

/** Removes one of a frame's guides; the guides after it move up one place. */
export const guideRemove = defineCommand({
  name: 'guide.remove',
  description:
    'Removes one of a frame’s guides; the guides after it move up one place. It refuses a missing frame and an index the frame has no guide at.',
  step: 'deleteGuide',
  input: z.strictObject({
    frameId: FrameId.describe('The frame the guide is in.'),
    index: GuideIndex.describe('The guide’s index in the frame’s guides.'),
  }),
  check: ({ design }, { frameId, index }) => guideProblem(design, frameId, index),
  apply: ({ w, design }, { frameId, index }) => {
    writeGuides(
      w,
      frameId,
      guidesOf(design, frameId).filter((_, i) => i !== index),
    )
  },
})

/** Removes every guide of a frame. */
export const guideClear = defineCommand({
  name: 'guide.clear',
  description: 'Removes every guide of a frame. It refuses a missing frame.',
  step: 'deleteGuides',
  input: z.strictObject({ frameId: FrameId.describe('The frame whose guides go.') }),
  check: ({ design }, { frameId }) => frameProblem(design, frameId),
  apply: ({ w }, { frameId }) => writeGuides(w, frameId, []),
})

/** A frame's guides, none when it has no list. */
function guidesOf(design: Design, frameId: string): readonly Guide[] {
  return design.frames[frameId]?.guides ?? []
}

/** Why a guide on `axis` may not go at `at` in a frame: off its width or height. */
function placeProblem(frame: Frame, axis: Guide['axis'], at: number) {
  const side = axis === 'x' ? frame.width : frame.height
  return at < 0 || at > side ? `a guide on ${axis} goes from 0 to ${side}, not ${at}` : undefined
}

/** Writes a frame's guides, leaving the key out when there are none. */
function writeGuides(w: StoreWrite, frameId: string, guides: readonly Guide[]) {
  if (guides.length === 0) w.unset('frame', frameId, 'guides')
  else w.set('frame', frameId, 'guides', guides)
}

/** Why frame `frameId` has no guide at `index`, if it has none: the frame is missing, or its list is shorter. */
function guideProblem(design: Design, frameId: string, index: number) {
  const problem = frameProblem(design, frameId)
  if (problem) return problem
  return index < guidesOf(design, frameId).length ? undefined : `frame "${frameId}" has no guide ${index}`
}
