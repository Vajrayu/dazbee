// A variable font draws the weight a text asks for: its weight axis is set to the text's weight, for
// the text's own style and each run's, where without it every weight drew the default instance.
import { describe, expect, it } from 'vitest'

import { FALLBACK_FAMILIES } from '@dazbee/fonts'
import { loadFontFiles } from '@dazbee/fonts/node'
import { variableTestFont } from '@dazbee/fonts/test-fonts'
import { TextProps } from '@dazbee/schema'

import { loadCanvasKit } from '../node.ts'
import { resourceCache } from '../resources.ts'
import { layoutText } from './layout.ts'

const ck = await loadCanvasKit()
const resources = resourceCache(ck).resources({
  fonts: [...loadFontFiles(), { family: 'Var Sans', bytes: variableTestFont() }],
  fallbackFamilies: [...FALLBACK_FAMILIES],
  images: {},
})

/** How wide `text` lays out on one line, in Var Sans at `weight`, with `runs`. */
function width(text: string, weight: number, runs: { start: number; end: number; style: object }[] = []) {
  const props = TextProps.parse({
    x: 0,
    y: 0,
    width: 4000,
    height: 200,
    text,
    runs,
    style: { fontFamily: 'Var Sans', fontSize: 100, fontWeight: weight, color: '#000000FF' },
  })
  const laid = layoutText(ck, props, resources)
  const wide = laid.blocks.reduce((sum, block) => sum + block.paragraph.getMaxIntrinsicWidth(), 0)
  laid.delete()
  return wide
}

describe('a variable font', () => {
  it('draws each weight a text asks for, not its default one', () => {
    const [thin = 0, regular = 0, bold = 0, black = 0] = [100, 400, 700, 900].map((w) => width('Weight Hamburger', w))
    expect(thin).toBeLessThan(regular - 20)
    expect(bold).toBeGreaterThan(regular + 20)
    expect(black).toBeGreaterThan(bold + 10)
  })

  it('draws a run at its own weight', () => {
    const run = (weight: number) => [{ start: 0, end: 6, style: { fontWeight: weight } }]
    expect(width('Weight Hamburger', 400, run(900))).toBeGreaterThan(width('Weight Hamburger', 400, run(400)) + 20)
  })
})
