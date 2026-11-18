import { describe, expect, it } from 'vitest'

import { grabCursor, resizeCursor, rotateCursor } from './cursors.ts'

/** The SVG inside a cursor drawn from an image, and its pieces in drawing order. */
function cursorSvg(cursor: string) {
  const svg = decodeURIComponent(/data:image\/svg\+xml,([^"]*)"/.exec(cursor)?.[1] ?? '')
  return { svg, paths: svg.match(/<path [^>]*\/>/g) ?? [] }
}

describe('resizeCursor', () => {
  it('points along the handle on an upright box', () => {
    expect(resizeCursor('e', 0)).toBe('ew-resize')
    expect(resizeCursor('w', 0)).toBe('ew-resize')
    expect(resizeCursor('n', 0)).toBe('ns-resize')
    expect(resizeCursor('se', 0)).toBe('nwse-resize')
    expect(resizeCursor('ne', 0)).toBe('nesw-resize')
  })

  it('turns with the box, to the nearest of the four', () => {
    expect(resizeCursor('e', 90)).toBe('ns-resize')
    expect(resizeCursor('e', -45)).toBe('nesw-resize')
    expect(resizeCursor('e', 170)).toBe('ew-resize')
    expect(resizeCursor('s', 400)).toBe('nesw-resize')
  })
})

describe('rotateCursor', () => {
  it('draws the turning arrow facing the corner, in whole degrees', () => {
    expect(rotateCursor(45)).toContain(encodeURIComponent('rotate(45 12 12)'))
    expect(rotateCursor(-135)).toContain(encodeURIComponent('rotate(225 12 12)'))
    expect(rotateCursor(44.8)).toBe(rotateCursor(45))
    expect(rotateCursor(45)).not.toBe(rotateCursor(135))
    expect(rotateCursor(45)).toMatch(/ 14 14, crosshair$/)
  })

  it('turns to face each corner of an upright selection', () => {
    expect(cursorSvg(rotateCursor(-45)).svg).toContain('rotate(315 12 12)')
    expect(cursorSvg(rotateCursor(-135)).svg).toContain('rotate(225 12 12)')
    expect(cursorSvg(rotateCursor(45)).svg).toContain('rotate(45 12 12)')
    expect(cursorSvg(rotateCursor(135)).svg).toContain('rotate(135 12 12)')
  })

  it('is a 28 px image with the 24 px drawing in its middle, so a turned arrowhead is never cut off', () => {
    expect(cursorSvg(rotateCursor(0)).svg).toMatch(/^<svg [^>]*width="28" height="28" viewBox="-2 -2 28 28"/)
  })

  it('draws a curved shaft, 2 px black over a 5 px white edge', () => {
    const shafts = cursorSvg(rotateCursor(0)).paths.filter((path) => path.includes('A9.5 9.5'))
    expect(shafts).toHaveLength(2)
    expect(shafts[0]).toMatch(/fill="none" stroke="white" stroke-width="5" stroke-linecap="round"/)
    expect(shafts[1]).toMatch(/fill="none" stroke="black" stroke-width="2" stroke-linecap="round"/)
  })

  it('draws two solid arrowheads, filled black over a 3 px white outline', () => {
    const heads = cursorSvg(rotateCursor(0)).paths.filter((path) => /d="[^"]*Z"/.exec(path))
    expect(heads).toHaveLength(4)
    expect(
      heads
        .slice(0, 2)
        .every((head) => /fill="white" stroke="white" stroke-width="3" stroke-linejoin="round"/.test(head)),
    ).toBe(true)
    expect(heads.slice(2).every((head) => /fill="black" stroke="black" stroke-width="0.6"/.test(head))).toBe(true)
  })

  it('draws all the white edge before any black', () => {
    const strokes = cursorSvg(rotateCursor(0)).paths.map((path) => /stroke="(\w+)"/.exec(path)?.[1])
    expect(strokes).toEqual(['white', 'white', 'white', 'black', 'black', 'black'])
  })
})

describe('grabCursor', () => {
  it('shows the cursor of what a press there grabs, on a box turned by `rotation`', () => {
    expect(grabCursor({ kind: 'resize', handle: 'n', drawn: false }, 0)).toBe('ns-resize')
    expect(grabCursor({ kind: 'resize', handle: 'se', drawn: true }, 90)).toBe('nesw-resize')
    expect(grabCursor({ kind: 'rotate', angle: 30 }, 0)).toBe(rotateCursor(30))
    // A line's end resizes along the line.
    expect(grabCursor({ kind: 'end', end: 'w', drawn: true }, 45)).toBe('nwse-resize')
    expect(grabCursor(null, 0)).toBe('')
  })

  it('shows no cursor of its own over a radius dot', () => {
    expect(grabCursor({ kind: 'radius', corner: 2, drawn: true }, 30)).toBe('')
  })
})
