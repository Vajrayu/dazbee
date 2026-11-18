import { describe, expect, it } from 'vitest'

import { type Constraints, type Layer, type Rect } from '@dazbee/schema'

import { guessedConstraints } from './constraints.ts'

const PARENT: Rect = { x: 0, y: 0, width: 100, height: 100 }
const STYLE = { fontFamily: 'Noto Sans', fontSize: 12, color: '#000000FF' }
const CROP = { type: 'image', assetId: 'photo', fit: 'crop', opacity: 1 }

/** A layer of `type` at `x, y, width, height`, with more props. */
const layer = (type: string, [x, y, width, height]: number[], props: Record<string, unknown> = {}) =>
  ({
    type,
    parentId: 'sq',
    link: 'l',
    index: 'a0',
    name: type,
    props: { x, y, width, height, rotation: 0, visible: true, ...props },
  }) as unknown as Layer
const graphic = (kind: string, at: number[], props: Record<string, unknown> = {}) =>
  layer('graphic', at, { shape: { kind }, ...props })
const text = (boxMode: string, at: number[]) => layer('text', at, { text: 'Hi', style: STYLE, boxMode })
const both = (horizontal: Constraints['horizontal'], vertical: Constraints['vertical']) => ({ horizontal, vertical })

/** Nearly as big as the parent: each side 5 in from its edge, a twentieth of the side. */
const WHOLE = [5, 5, 90, 90]

describe('guessedConstraints', () => {
  it.each([
    ['a box', layer('box', WHOLE)],
    ['a rect', graphic('rect', WHOLE)],
    ['a line', graphic('line', WHOLE)],
    ['a text of a fixed size', text('fixed', WHOLE)],
    ['a box turned a quarter turn', layer('box', WHOLE, { rotation: 90 })],
    ['a rect with an image fill in Fill fit', graphic('rect', WHOLE, { fills: [{ ...CROP, fit: 'fill' }] })],
  ])('stretches %s whose sides are within a tenth of the parent’s on both axes', (_, at) => {
    expect(guessedConstraints(at, PARENT)).toEqual(both('leftRight', 'topBottom'))
  })

  it.each([
    ['an ellipse', graphic('ellipse', WHOLE)],
    ['a path', graphic('path', WHOLE)],
    ['a star', graphic('star', WHOLE)],
    ['a group', layer('group', WHOLE)],
    ['a boolean', layer('boolean', WHOLE)],
    ['a layer turned 30°', layer('box', [20, 20, 60, 60], { rotation: 30 })],
    ['a rect with an image fill in Crop fit', graphic('rect', WHOLE, { fills: [CROP] })],
    ['a box with an image fill in Crop fit', layer('box', WHOLE, { fills: [CROP] })],
  ])('goes by the middle of %s, which would bend its look stretched', (_, at) => {
    expect(guessedConstraints(at, PARENT)).toEqual(both('center', 'center'))
  })

  it('stretches a text along each side that does not grow with its words, and goes by its middle along one that does', () => {
    expect(guessedConstraints(text('autoHeight', WHOLE), PARENT)).toEqual(both('leftRight', 'center'))
    expect(guessedConstraints(text('autoWidth', WHOLE), PARENT)).toEqual(both('center', 'center'))
  })

  it('reads a text turned a quarter turn by its own sides: its own height is drawn across, its width down', () => {
    const turned = (at: number[]) =>
      layer('text', at, { text: 'Hi', style: STYLE, boxMode: 'autoHeight', rotation: 90 })
    // Drawn 5 to 95 across: that is its own height, which grows with its words.
    expect(guessedConstraints(turned([40, 5, 20, 90]), PARENT)).toEqual(both('center', 'center'))
    // Drawn 5 to 95 down: that is its own width, which doesn't.
    expect(guessedConstraints(turned([5, 40, 90, 20]), PARENT)).toEqual(both('center', 'topBottom'))
  })

  it('goes by the middle along a side of a laid-out box that fits what it holds', () => {
    const layout = { direction: 'row', gap: 0, padding: { top: 0, right: 0, bottom: 0, left: 0 } }
    const row = layer('box', WHOLE, { layout, sizing: { width: 'fixed', height: 'hug' } })
    expect(guessedConstraints(row, PARENT)).toEqual(both('leftRight', 'center'))
  })

  it('stretches only along the axis whose two sides are within a tenth of the parent’s edges, sticking out included', () => {
    expect(guessedConstraints(graphic('rect', [-20, 40, 130, 20]), PARENT)).toEqual(both('leftRight', 'center'))
    expect(guessedConstraints(graphic('rect', [11, 0, 80, 100]), PARENT)).toEqual(both('center', 'topBottom'))
    expect(guessedConstraints(graphic('rect', [10, 10, 80, 80]), PARENT)).toEqual(both('leftRight', 'topBottom'))
  })

  it.each([
    [[0, 0, 20, 20], both('left', 'top')],
    [[40, 40, 20, 20], both('center', 'center')],
    [[80, 80, 20, 20], both('right', 'bottom')],
    [[10, 70, 20, 20], both('left', 'bottom')],
    [[70, 10, 20, 20], both('right', 'top')],
    // Its middle at 33.5, just past the first third, and at 66.5, just short of the last.
    [[23.5, 56.5, 20, 20], both('center', 'center')],
  ])('goes by the third its middle is in: a layer at %j is %j', (at, guess) => {
    expect(guessedConstraints(graphic('ellipse', at), PARENT)).toEqual(guess)
  })

  it('reads the layer’s place from its parent’s start, as a box holding it is', () => {
    const parent = { x: 200, y: 300, width: 100, height: 100 }
    expect(guessedConstraints(graphic('ellipse', [280, 300, 20, 20]), parent)).toEqual(both('right', 'top'))
    expect(guessedConstraints(graphic('rect', [205, 395, 90, 5]), parent)).toEqual(both('leftRight', 'bottom'))
  })

  it('goes by a turned layer’s drawn bounds', () => {
    // A 100 × 20 rect turned a quarter turn about its middle at 50, 85 is drawn 20 wide and 100 tall: 40 to 60 across, 35 to 135 down.
    expect(guessedConstraints(graphic('rect', [0, 75, 100, 20], { rotation: 90 }), PARENT)).toEqual(
      both('center', 'bottom'),
    )
  })

  it('never guesses scale', () => {
    const guesses = [WHOLE, [0, 0, 10, 10], [45, 45, 10, 10], [90, 90, 10, 10]].flatMap((at) =>
      Object.values(guessedConstraints(graphic('rect', at), PARENT)),
    )
    expect(guesses).not.toContain('scale')
  })
})
