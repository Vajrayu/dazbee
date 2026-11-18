import { describe, expect, it } from 'vitest'

import { DropShadow } from './effects.ts'

describe('DropShadow', () => {
  const shadow = { type: 'dropShadow', x: 0, y: 8, blur: 24, color: '#00000040' }

  it('keeps showBehind when set, and leaves it out when left out, which hides the shadow behind the layer', () => {
    expect(DropShadow.parse({ ...shadow, showBehind: true })).toMatchObject({ showBehind: true })
    expect(DropShadow.parse(shadow)).not.toHaveProperty('showBehind')
  })

  it('refuses a showBehind that is not true or false', () => {
    expect(DropShadow.safeParse({ ...shadow, showBehind: 'yes' }).success).toBe(false)
  })
})
