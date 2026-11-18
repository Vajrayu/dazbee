// A layer's least and most width and height as Arrange sets them: where they apply, a limit added
// at the size the layer is drawn, one set keeping the least at most the most by moving the other,
// and both of a side taken out.
import { type Axis, laidOutBox, placedByFlow } from '@dazbee/doc'
import { type Design, type LayerLimits } from '@dazbee/schema'

import { type Patch, type Props } from '@/components/editor/edit-panel/target.ts'
import { tidy } from '@/lib/editor/size.ts'

/** Which limit of a side: its least or its most. */
export type LimitEnd = 'min' | 'max'

/** What a side's sizing menu offers for its limits. */
export type LimitChoice = 'add-min' | 'add-max' | 'remove'

/** Each side's limits by end, as stored. */
export const LIMIT_KEYS = {
  width: { min: 'minWidth', max: 'maxWidth' },
  height: { min: 'minHeight', max: 'maxHeight' },
} as const satisfies Record<Axis, Record<LimitEnd, keyof LayerLimits>>

/** The layer types that keep limits: those with a size of their own. */
const LIMITED_TYPES: ReadonlySet<string> = new Set(['graphic', 'text', 'box'])

/**
 * Whether limits apply to every one of the layers: each keeps them, and is a laid-out box or a layer
 * its box's flow places, where auto layout sizes it.
 */
export function limitsApply(design: Design, ids: readonly string[]): boolean {
  return ids.every((id) => {
    const node = design.nodes[id]
    return node !== undefined && LIMITED_TYPES.has(node.type) && (laidOutBox(design, id) || placedByFlow(design, id))
  })
}

/**
 * A side's limit set to `to` on a layer whose values are `now`: the other end moves to it where it
 * would pass it, so the least is never more than the most.
 */
export function limitPatch(now: Props, axis: Axis, end: LimitEnd, to: number): Patch {
  const keys = LIMIT_KEYS[axis]
  const other = now[keys[end === 'min' ? 'max' : 'min']] as number | undefined
  const passes = other !== undefined && (end === 'min' ? other < to : other > to)
  return { [keys[end]]: to, ...(passes ? { [keys[end === 'min' ? 'max' : 'min']]: to } : {}) }
}

/** A side's limit added at the size the layer is drawn at. */
export function addedLimit(now: Props, axis: Axis, end: LimitEnd): Patch {
  return limitPatch(now, axis, end, tidy(now[axis] as number))
}

/** Both of a side's limits taken out. */
export function noLimits(axis: Axis): Patch {
  return { [LIMIT_KEYS[axis].min]: undefined, [LIMIT_KEYS[axis].max]: undefined }
}

/** Whether any of the layers has a least or a most on a side. */
export function hasLimits(props: readonly Props[], axis: Axis): boolean {
  const keys = LIMIT_KEYS[axis]
  return props.some((pr) => pr[keys.min] !== undefined || pr[keys.max] !== undefined)
}

/** What a side's sizing menu offers for limits: adding each end none of the layers has, and taking both out where any has one. */
export function limitChoices(props: readonly Props[], axis: Axis): LimitChoice[] {
  const keys = LIMIT_KEYS[axis]
  const any = (end: LimitEnd) => props.some((pr) => pr[keys[end]] !== undefined)
  return [
    ...(any('min') ? [] : ['add-min' as const]),
    ...(any('max') ? [] : ['add-max' as const]),
    ...(hasLimits(props, axis) ? ['remove' as const] : []),
  ]
}
