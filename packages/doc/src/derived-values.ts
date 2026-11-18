// The values of a design worked out from others (D6), as Dazbee works them out: the box of a text
// that grows with its words, and the box of each group and boolean around what it holds. A tab
// writes them in the step that changes what they come from (typing, node.hug); after crossing edits
// its client brings them up to date with a follow-up, through this recompute (sync/follow-up.ts).
import { type Change, type Design, type Layer, parseLayer } from '@dazbee/schema'

import { ancestorsOf, fitsItsLayers } from './children.ts'
import { boxPlan } from './commands/box-plan.ts'
import { planHug } from './commands/groups.ts'
import { recordOf } from './sync/changes.ts'
import type { Recompute } from './sync/follow-up.ts'
import type { ReadState } from './sync/state.ts'

/**
 * The box a text layer takes as it grows with its words (`fittedText` with the editor's measure and
 * the brand kit's fonts), undefined for a layer that keeps its box, or `'wait'` while a font it is
 * drawn in is still loading.
 */
export type FitText = (layer: Layer) => { width: number; height: number } | 'wait' | undefined

/** The layers a recompute reads, as a design of just them, and the touched ones among them. */
interface Chains {
  design: Design
  touched: string[]
}

/** Up to this a number holds its hundredths, to which boxes are rounded (D6). */
const EXACT = 2 ** 53 / 100

/**
 * Dazbee's recompute: over the layers touched, each text fitted to its words through `fit`, then
 * the groups and booleans those layers are in, and those touched, fitted to what they hold as
 * `node.hug` fits them. It reads only those layers, their chains of holders and what the groups
 * on them hold. A layer with a box number past where a number holds its hundredths (one placed at
 * an extreme), and every group and boolean it is in, keeps its box, and so does a text that would
 * be measured that large: fitted there, the box would come out a little otherwise each time.
 */
export function derivedValues(fit: FitText): Recompute {
  return (state, keys) => {
    const { design, touched } = chainsOf(state, keys)
    const leave = new Set<string>()
    for (const [id, layer] of Object.entries(design.nodes)) {
      if (!exact(layer.props)) for (const up of ancestorsOf(design, id)) leave.add(up)
    }
    const plan = boxPlan(design)
    for (const id of touched) {
      const layer = design.nodes[id] as Layer
      const size = leave.has(id) || layer.type !== 'text' ? undefined : fit(layer)
      if (size === 'wait') return 'wait'
      if (size && exact(size)) plan.set(id, size)
    }
    planHug(design, plan, touched, leave)
    const changes: Change[] = []
    plan.write({
      setProp: (id, prop, to) => {
        changes.push({ op: 'set', value: { part: 'layer', id, key: 'props', prop }, to })
      },
    })
    return changes
  }
}

/**
 * The layers among `keys`, each one's chain of holders up to its frame, and everything the groups
 * and booleans on those chains hold, as the read gives them. A chain that comes back to a layer it
 * passed (a working design can hold one until the server rejects the change set) stops before it:
 * the layers that hold each other are left out, and keep their boxes.
 */
function chainsOf(state: ReadState, keys: ReadonlySet<string>): Chains {
  const nodes = new Map<string, Layer>()
  const looped = new Set<string>()
  const take = (id: string) => {
    if (looped.has(id)) return undefined
    if (!nodes.has(id)) {
      const parsed = parseLayer(state.get('layer', id))
      if (!parsed.success) return undefined
      nodes.set(id, parsed.layer)
    }
    return nodes.get(id)
  }
  const touched = [...keys].flatMap((key) => {
    const { part, id } = recordOf(key)
    return part === 'layer' && take(id) ? [id] : []
  })
  const holders = new Set<string>()
  for (const id of touched) {
    const path: string[] = []
    for (let up: string | undefined = id; up !== undefined && take(up); up = nodes.get(up)?.parentId) {
      const at = path.indexOf(up)
      if (at >= 0) {
        for (const inside of path.slice(at)) looped.add(inside)
        break
      }
      path.push(up)
    }
    for (const up of path) if (fitsItsLayers(nodes.get(up))) holders.add(up)
  }
  for (const holder of holders) {
    if (looped.has(holder)) continue
    for (const inside of state.subtree(holder)) take(inside)
  }
  const kept = [...nodes].filter(([id]) => !looped.has(id))
  return {
    design: { meta: {}, pages: {}, frames: {}, nodes: Object.fromEntries(kept) } as unknown as Design,
    touched: touched.filter((id) => !looped.has(id)),
  }
}

/** Whether a box's numbers hold their hundredths (`EXACT`). */
function exact(box: Readonly<Record<string, unknown>>): boolean {
  return (['x', 'y', 'width', 'height'] as const).every((key) => Math.abs(Number(box[key] ?? 0)) <= EXACT)
}
