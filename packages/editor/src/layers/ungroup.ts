// What Ungroup would do for the selection, frame by frame: the groups, boxes and booleans that come
// apart with every layer of their frame staying where it is drawn, and why the others stay whole.
import { childrenOf, laidOutBox, openSession, plainStore, type Session } from '@dazbee/doc'
import type { Design } from '@dazbee/schema'

import type { Frame } from '../canvas/frames.ts'
import { runQuietly } from '../run-quietly.ts'
import type { EditorBoxes } from './boxes.ts'
import type { Box } from './transform.ts'

/** What Ungroup would do for the selection, or why it has nothing to do (`EditorActions.ungroupState`). */
export type UngroupState = 'ready' | 'none' | 'locked' | 'maskLocked' | 'placedByLayout'
/** What Ungroup reads of the layers' boxes. */
type UngroupBoxes = Pick<EditorBoxes, 'rootsByFrame' | 'drawnInFlow' | 'drawnAlike'>

/** What Ungroup would do for the selection, or why it has nothing to do. */
export function ungroupStateOf(session: Session, boxes: UngroupBoxes): UngroupState {
  const { groups, selected, locked, maskLocked } = ungroupable(session, boxes)
  if (selected === 0) return 'none'
  if (groups.length > 0) return 'ready'
  if (locked > 0) return 'locked'
  return maskLocked > 0 ? 'maskLocked' : 'placedByLayout'
}

/**
 * The selected groups, boxes and booleans that come apart with nothing moving, each with where
 * what it holds is drawn; how many were selected; and how many stay whole because their auto
 * layout box would place what they hold elsewhere. One locked against deleting stays whole too,
 * as does one that would free a mask with its style locked.
 */
export function ungroupable(session: Session, boxes: UngroupBoxes) {
  const now = session.design()
  const placed = (id: string) => boxes.drawnInFlow(childrenOf(now, id).map(([child]) => child)) ?? {}
  const maskLocked = (id: string) => childrenOf(now, id).some(([, kid]) => kid.props.mask && kid.lock?.style)
  const parts = boxes.rootsByFrame(now).map(({ frame, ids }) => {
    const containers = ids.filter((id) => ['group', 'box', 'boolean'].includes(now.nodes[id]?.type ?? ''))
    const unlocked = containers.filter((id) => !now.nodes[id]?.lock?.delete)
    const free = unlocked.filter((id) => !maskLocked(id))
    const groups = free
      .filter(
        (id) => !laidOutBox(now, now.nodes[id]?.parentId ?? '') || ungroupKeeps(boxes, frame, id, placed(id), now),
      )
      .map((id) => ({ id, drawn: placed(id) }))
    return {
      frame,
      groups,
      selected: containers.length,
      locked: containers.length - unlocked.length,
      maskLocked: unlocked.length - free.length,
      placedByLayout: free.length - groups.length,
    }
  })
  const count = (key: 'selected' | 'locked' | 'maskLocked' | 'placedByLayout') =>
    parts.reduce((n, part) => n + part[key], 0)
  return {
    parts,
    groups: parts.flatMap((part) => part.groups),
    selected: count('selected'),
    locked: count('locked'),
    maskLocked: count('maskLocked'),
    placedByLayout: count('placedByLayout'),
  }
}

/**
 * Whether ungrouping a layer leaves every layer of its frame drawn where it is, tried on a copy of
 * the design, a scratch store: in an auto layout box, the flow places what the layer held once it
 * is out. A step the scratch store's server rejects faults, and the layer is kept.
 */
function ungroupKeeps(
  boxes: UngroupBoxes,
  frame: Frame,
  id: string,
  placed: Record<string, Omit<Box, 'rotation'>>,
  now: Design,
) {
  const trial = openSession(plainStore(now, { scratch: true }))
  return (
    runQuietly(() => trial.run('node.ungroup', { ids: [id], drawn: placed })) &&
    boxes.drawnAlike(frame.id, now, trial.design())
  )
}
