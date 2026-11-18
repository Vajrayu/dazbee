import { describe, expect, it } from 'vitest'

import { armsOnClick, type Placeable } from './place-asset.ts'

const PHOTO: Placeable = { id: 'p', name: 'Photo', width: 400, height: 200, contentType: 'image/png' }
const LOGO: Placeable = { ...PHOTO, id: 'l', name: 'Logo', contentType: 'image/svg+xml' }

describe('armsOnClick', () => {
  it('arms an image clicked with a mouse or a pen, to place with the next click or drag on a frame', () => {
    expect(armsOnClick(PHOTO, 'mouse', 1)).toBe(true)
    expect(armsOnClick(PHOTO, 'pen', 1)).toBe(true)
  })

  it('places at once from a key, which clicks with no pointer, a tap, or an SVG file', () => {
    expect(armsOnClick(PHOTO, 'mouse', 0)).toBe(false)
    expect(armsOnClick(PHOTO, null, 0)).toBe(false)
    expect(armsOnClick(PHOTO, 'touch', 1)).toBe(false)
    expect(armsOnClick(LOGO, 'mouse', 1)).toBe(false)
  })
})
