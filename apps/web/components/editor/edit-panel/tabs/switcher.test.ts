// Which keys move along the switcher, picking the switcher tab they reach.
import { describe, expect, it } from 'vitest'

import { movesAlong } from './switcher.tsx'

describe('movesAlong', () => {
  it('moves along the switcher with the arrow keys across, Home and End', () => {
    expect(['ArrowLeft', 'ArrowRight', 'Home', 'End'].map(movesAlong)).toEqual([true, true, true, true])
  })

  it('leaves every other key to the page, so Shift, Shift+I or Ctrl+Z on a focused switcher tab picks none', () => {
    expect(['Shift', 'I', 'z', 'Enter', ' ', 'Tab', 'ArrowDown', 'Escape'].map(movesAlong)).toEqual(
      Array(8).fill(false),
    )
  })
})
