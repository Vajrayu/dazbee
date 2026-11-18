// An Alt-drag's test fixture: the whole editor opened in Node over a design, with what the tests
// of an Alt-drag read of it.
import { expect } from 'vitest'

import type { Design, DesignInput } from '@dazbee/schema'

import { DESIGN } from '../../test-actions.ts'
import { testEditor, type TestEditorOptions } from '../../test-editor.ts'
import type { PointerInput } from '../inputs.ts'

const deepCopy = (design: Design) => JSON.parse(JSON.stringify(design)) as Design

/**
 * The editor over a design, opened with `options`, with the square frame's design pixels as stage
 * points (`at`), the pointer taken there (`go`), one pointer input sent with only what it says of
 * Alt (`send`), the design as opened, and the layers made since.
 */
export async function openAltDrag(design: DesignInput = DESIGN, options?: TestEditorOptions) {
  const editor = await testEditor(design, options)
  const { core, mouse, keys } = editor
  const at = (x: number, y: number) => core.stagePoint(x, y, 'sq')
  const go = (x: number, y: number) => mouse.move(at(x, y).x, at(x, y).y)
  const before = deepCopy(core.design())
  const made = () => Object.keys(core.design().nodes).filter((id) => !(id in before.nodes))
  const send = (type: PointerInput['type'], x: number, y: number, altKey = false, pointerType = 'mouse') => {
    const answer = core.input.pointer({
      ...{ type, at: at(x, y), button: 0, detail: 0, shiftKey: false, altKey, ctrlKey: false, metaKey: false },
      pointerType,
    })
    core.redraw()
    return answer
  }
  /** Whether the design is as it was opened. */
  const unchanged = () => expect(deepCopy(core.design())).toEqual(before)
  return { editor, core, mouse, keys, at, go, send, before, made, unchanged }
}
