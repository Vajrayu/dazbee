// The checks commands share: a free id, a parent that can hold a layer, a page or frame that exists,
// locks, and layers that exist.
import { canHold, type Design, type Layer as LayerT, LayerLock } from '@dazbee/schema'

import type { CommandContext } from './define.ts'

/** The properties that set a layer's size, turn and flip, and whether its ratio is locked, which the resize lock keeps. */
const RESIZE_PATHS = new Set(['width', 'height', 'rotation', 'flipX', 'flipY', 'lockRatio'])

/**
 * Why a new id a caller gives is not free, if it is not: a page, a frame or a layer holds it now,
 * whatever its read makes of it (C27).
 */
export const idProblem = ({ w }: CommandContext, id: string | undefined) =>
  id && w.isLive(id) ? `id "${id}" is taken` : undefined

export const parentProblem = (design: Design, parentId: string, type: string) => {
  const parent = design.nodes[parentId]
  if (!Object.hasOwn(design.frames, parentId) && !parent) return `parent "${parentId}" is neither a frame nor a layer`
  if (parent && !canHold(parent.type, type)) {
    return parent.type === 'boolean'
      ? `parent "${parentId}" is a boolean, which holds only shapes and booleans`
      : `parent "${parentId}" is a ${parent.type}, which can't hold layers`
  }
  return undefined
}

export const pageProblem = (design: Design, pageId: string) =>
  Object.hasOwn(design.pages, pageId) ? undefined : `no page "${pageId}"`

export const frameProblem = (design: Design, frameId: string) =>
  Object.hasOwn(design.frames, frameId) ? undefined : `no frame "${frameId}"`

/**
 * The lock flag a change to a property needs clear: position and constraints, size, rotation, flip
 * and Lock ratio, content or style.
 */
export function lockFor(path: string): keyof LayerLock | null {
  if (path === 'x' || path === 'y' || path === 'constraints') return 'move'
  if (RESIZE_PATHS.has(path)) return 'resize'
  if (path === 'visible') return null
  if (path === 'text' || path === 'runs') return 'content'
  return 'style'
}

export const lockProblem = (id: string, node: LayerT, flag: keyof LayerLock | null) =>
  flag && node.lock?.[flag] ? `"${id}" is locked (${flag})` : undefined

/** The first of `ids` that names no layer, as a reason to refuse. */
export const missingLayer = (design: Design, ids: readonly string[]) => {
  const id = ids.find((one) => !design.nodes[one])
  return id === undefined ? undefined : `no layer "${id}"`
}
