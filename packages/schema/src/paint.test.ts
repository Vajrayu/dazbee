import { describe, expect, it } from 'vitest'

import {
  boundFillIndex,
  changeFill,
  ImageCrop,
  ImagePaint,
  type Paint,
  paintColour,
  showingFillIndex,
} from './paint.ts'

const WHITE: Paint = { type: 'solid', color: '#FFFFFFFF' }
const HIDDEN: Paint = { type: 'solid', color: '#000000FF', visible: false }
const IMAGE: Paint = { type: 'image', assetId: 'photo', fit: 'fill', opacity: 1 }
const GREY: Paint = { type: 'solid', color: '#D9D9D9FF' }

describe('ImageCrop', () => {
  it('may reach past the image on any side, where the layer shows nothing', () => {
    expect(ImageCrop.safeParse({ x: -120, y: -40, width: 900, height: 600 }).success).toBe(true)
  })

  it('has a size', () => {
    expect(ImageCrop.safeParse({ x: 0, y: 0, width: 0, height: 600 }).success).toBe(false)
    expect(ImageCrop.safeParse({ x: 0, y: 0, width: 900, height: -1 }).success).toBe(false)
  })
})

describe('ImagePaint', () => {
  it("keeps a tile scale from 1 % to 1000 %, and leaves it out when left out, which tiles at the image's own size", () => {
    for (const tileScale of [0.01, 0.5, 10])
      expect(ImagePaint.parse({ ...IMAGE, fit: 'tile', tileScale })).toMatchObject({ tileScale })
    expect(ImagePaint.parse(IMAGE)).not.toHaveProperty('tileScale')
    for (const tileScale of [1e-9, 0.0099, 10.01, 0, -1])
      expect(ImagePaint.safeParse({ ...IMAGE, tileScale }).success).toBe(false)
  })
})

describe('boundFillIndex', () => {
  it('is the topmost solid fill that shows, -1 with none', () => {
    expect(boundFillIndex([WHITE, IMAGE, HIDDEN])).toBe(0)
    expect(boundFillIndex([IMAGE])).toBe(-1)
  })
})

describe('showingFillIndex', () => {
  it('is the topmost fill that shows, whatever its type, -1 with none', () => {
    expect(showingFillIndex([WHITE, IMAGE, HIDDEN])).toBe(1)
    expect(showingFillIndex([HIDDEN])).toBe(-1)
    expect(showingFillIndex([])).toBe(-1)
  })
})

describe('changeFill', () => {
  it('changes the fill at an index, leaving the others as they are', () => {
    const fills = [WHITE, IMAGE]
    expect(changeFill(fills, 0, () => HIDDEN, GREY)).toEqual([HIDDEN, IMAGE])
    expect(fills).toEqual([WHITE, IMAGE])
  })

  it('puts the added fill, changed, on top at -1', () => {
    expect(changeFill([IMAGE], -1, paintColour('#2f6bff'), GREY)).toEqual([
      IMAGE,
      { type: 'solid', color: '#2F6BFFFF' },
    ])
  })
})

describe('paintColour', () => {
  it('paints a solid the colour, upper case and opaque, keeping its other settings', () => {
    expect(paintColour('#2f6bff')({ ...WHITE, opacity: 0.5 })).toEqual({
      type: 'solid',
      color: '#2F6BFFFF',
      opacity: 0.5,
    })
  })

  it('makes any other paint a solid of the colour', () => {
    expect(paintColour('#2F6BFF')(IMAGE)).toEqual({ type: 'solid', color: '#2F6BFFFF' })
  })
})
