import { describe, expect, it } from 'vitest'

import type { Session } from '@dazbee/doc'

import type { NoticeDetail } from './core-interface.ts'
import { editorLeftOut } from './layers-left-out.ts'

/**
 * The left-out notice on a stand-in session whose design leaves out the layers in `out`, the
 * notices told, and whether the page listens.
 */
function opened(listening = true) {
  const out: string[] = []
  const session = {
    leftOut: () => [...out.map((id) => ({ part: 'layer', id })), { part: 'frame', id: 'not-a-layer' }],
  } as unknown as Session
  const told: NoticeDetail[] = []
  const heard = { listening }
  const leftOut = editorLeftOut({ session, listening: () => heard.listening, notify: (...notice) => told.push(notice) })
  return { leftOut, told, heard, out }
}

describe('editorLeftOut', () => {
  it('tells nothing while the design leaves out no layer', () => {
    const { leftOut, told } = opened()
    leftOut.tell()
    expect(told).toEqual([])
  })

  it('tells the page once how many layers the design leaves out, however often it is asked', () => {
    const { leftOut, told, out } = opened()
    out.push('first')
    leftOut.tell()
    out.push('second')
    leftOut.tell()
    expect(told).toEqual([['layersLeftOut', { layers: 1 }]])
  })

  it('tells again of layers left out after the design read whole between', () => {
    const { leftOut, told, out } = opened()
    out.push('first')
    leftOut.tell()
    out.length = 0
    leftOut.tell()
    out.push('second')
    leftOut.tell()
    expect(told).toEqual([
      ['layersLeftOut', { layers: 1 }],
      ['layersLeftOut', { layers: 1 }],
    ])
  })

  it('waits for the page to listen before it tells', () => {
    const { leftOut, told, heard, out } = opened(false)
    out.push('first', 'second')
    leftOut.tell()
    expect(told).toEqual([])
    heard.listening = true
    leftOut.tell()
    expect(told).toEqual([['layersLeftOut', { layers: 2 }]])
  })
})
