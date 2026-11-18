// The name a new group, Mask group or box takes.
import { describe, expect, it } from 'vitest'

import { ar } from '@/lib/i18n/ar.ts'
import { en } from '@/lib/i18n/en.ts'

import { layerName } from './layer-name.ts'

describe('layerName', () => {
  it("names a new group, Mask group and box in the app's words", () => {
    expect(layerName(en, 'group')).toBe('Group')
    expect(layerName(en, 'maskGroup')).toBe('Mask group')
    expect(layerName(en, 'box')).toBe('Box')
    expect(layerName(ar, 'maskGroup')).toBe('مجموعة قناع')
  })
})
