// Whether layers can be wrapped in a new group, box or boolean in each frame, or why not: the one
// rule the menus grey their items by and the actions run by.
import { wrapRefusal } from '@dazbee/doc'
import type { Design } from '@dazbee/schema'

/** What wrapping the selection would do, or why it has nothing to do. */
export type WrapState = 'ready' | 'none' | 'apart' | 'locked' | 'held'

/**
 * What wrapping each frame's selected layers in a new layer of `type` would do: `ready` while each
 * frame's layers can go in one; otherwise why not, the first that holds of: `apart` when a frame's
 * layers are in different boxes or groups, `locked` when one is locked in place, `held` when their
 * parent can't hold that layer (a boolean holds no group or box); `none` with no layer selected.
 */
export function wrapStateOf(
  design: Design,
  parts: readonly { ids: readonly string[] }[],
  type: 'group' | 'box' | 'boolean',
): WrapState {
  if (parts.length === 0) return 'none'
  const refusals = parts.map(({ ids }) => wrapRefusal(design, ids, type))
  return (['apart', 'locked', 'held'] as const).find((why) => refusals.includes(why)) ?? 'ready'
}

/** Why a wrap in `state` can't go ahead, the reason the app gives; null while it is ready or nothing is selected. */
export function whyNotWrapped(state: WrapState): Exclude<WrapState, 'ready' | 'none'> | null {
  return state === 'ready' || state === 'none' ? null : state
}
