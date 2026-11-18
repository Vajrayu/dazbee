// The stage's cursor while a colour is picked: hidden, as the loupe stands where it
// would be, until picking ends; a pan held or ready still shows its hand.
import { afterEach, describe, expect, it } from 'vitest'

import { type TestEditor, testEditor } from '../test-editor.ts'
import { DESIGN, middle } from './test-colour-pick.ts'

let editor: TestEditor | undefined
afterEach(() => {
  editor?.end()
  editor = undefined
})

describe('the stage’s cursor while picking a colour', () => {
  it('hides from the start to the end, and shows the tool’s again after', async () => {
    const e = (editor = await testEditor(DESIGN))
    const told: string[] = []
    e.core.input.onCursor((cursor) => told.push(cursor))
    expect(e.core.input.cursor()).toBe('')
    void e.core.pickColour()
    expect(e.core.input.cursor()).toBe('none')
    e.core.stopPicking()
    expect(e.core.input.cursor()).toBe('')
    expect(told).toEqual(['none', ''])
  })

  it('shows the tool’s again once a click picks', async () => {
    const e = (editor = await testEditor(DESIGN))
    e.core.zoomTo(1)
    const picked = e.core.pickColour()
    const at = middle(e, 'sq', 60, 50)
    e.mouse.move(at.x, at.y)
    expect(e.core.input.cursor()).toBe('none')
    e.mouse.click(at.x, at.y)
    expect(await picked).toBe('#E0301E')
    expect(e.core.input.cursor()).toBe('')
  })

  it('shows the hand while Space readies a pan, and hides again as it is let go', async () => {
    const e = (editor = await testEditor(DESIGN))
    void e.core.pickColour()
    e.keys.down('Space')
    expect(e.core.input.cursor()).toBe('grab')
    e.keys.up('Space')
    expect(e.core.input.cursor()).toBe('none')
  })
})
