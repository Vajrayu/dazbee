// Deleting and hiding layers: a laid-out box that either leaves with nothing in its flow keeps the
// size it is drawn at.
import type { Session } from '@dazbee/doc'

import { stepOf } from '../shortcuts.ts'
import type { EditorBoxes } from './boxes.ts'
import { hug } from './hug.ts'

/** Deletes layers in their frame, their linked copies left, the groups they leave fitting what they hold again. */
export function deleteLayers(session: Session, boxes: Pick<EditorBoxes, 'drawnHolders'>, ids: string[]) {
  const now = session.design()
  const parents = ids.map((id) => now.nodes[id]?.parentId ?? '').filter((id) => now.nodes[id])
  session.run('node.delete', { ids, holders: boxes.drawnHolders(ids) })
  hug(session, parents)
}

/** Hides or shows layers in their frame, their linked copies left as they are, as one step named hide or show. */
export function setHidden(session: Session, boxes: Pick<EditorBoxes, 'drawnHolders'>, ids: string[], hidden: boolean) {
  session.gesture(hidden ? stepOf('hide') : 'show', () =>
    session.run('node.update', {
      ids,
      patch: { visible: !hidden },
      ...(hidden ? { holders: boxes.drawnHolders(ids) } : {}),
    }),
  )
}
