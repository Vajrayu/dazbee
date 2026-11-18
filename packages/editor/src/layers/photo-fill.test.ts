import { describe, expect, it } from 'vitest'

import type { Paint } from '@dazbee/schema'

import { sharedImageFill } from './photo-fill.ts'

const BLUE: Paint = { type: 'solid', color: '#2F6BFFFF', opacity: 1, visible: true }
const photo = (assetId: string): Paint => ({ type: 'image', assetId, fit: 'fill', opacity: 1, visible: true })

describe('sharedImageFill', () => {
  it('finds the last image fill of the one fill list every layer has', () => {
    expect(sharedImageFill([[photo('a'), BLUE]])).toEqual({ index: 0, paint: photo('a') })
    expect(
      sharedImageFill([
        [photo('a'), BLUE, photo('b')],
        [photo('a'), BLUE, photo('b')],
      ]),
    ).toEqual({ index: 2, paint: photo('b') })
  })

  it('finds none when the layers have different fill lists, or theirs holds no image fill', () => {
    expect(sharedImageFill([[photo('a')], [photo('b')]])).toBeNull()
    expect(sharedImageFill([[photo('a')], [photo('a'), BLUE]])).toBeNull()
    expect(sharedImageFill([[photo('a')], [BLUE]])).toBeNull()
    expect(sharedImageFill([[BLUE], [BLUE]])).toBeNull()
    expect(sharedImageFill([[]])).toBeNull()
    expect(sharedImageFill([])).toBeNull()
  })
})
