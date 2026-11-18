import type { Session } from '@dazbee/doc'

import type { NoticeDetail } from './core-interface.ts'

interface LeftOutDeps {
  session: Session
  /** Whether the page hears the notices yet. */
  listening: () => boolean
  notify: (...told: NoticeDetail<'layersLeftOut'>) => void
}

/**
 * Tells the page how many layers the open design leaves out because they could not be read
 * (`session.leftOut`): once each time the design goes from leaving none out to leaving some out,
 * while the page listens. A design that reads whole again is told of the next layers it leaves out.
 */
export function editorLeftOut({ session, listening, notify }: LeftOutDeps) {
  /** Whether the page was told of the layers the design leaves out now. */
  let told = false

  function tell() {
    const layers = session.leftOut().filter(({ part }) => part === 'layer').length
    if (layers === 0) told = false
    if (told || layers === 0 || !listening()) return
    told = true
    notify('layersLeftOut', { layers })
  }

  return { tell }
}
