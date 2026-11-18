import { describe, expect, it } from 'vitest'

import {
  exportFits,
  ExportRequest,
  MAX_EXPORT_PIXELS,
  MAX_EXPORT_SIDE,
  numberedFrameNames,
  safeFileName,
} from './export.ts'

const frame = (pageId: string, name: string, order: string) => ({
  pageId,
  name,
  width: 100,
  height: 100,
  x: 0,
  y: 0,
  fills: [],
  order,
})

describe('numberedFrameNames', () => {
  it("names a page's frames in its order, a name an earlier frame has, in any case, numbered from 2", () => {
    const frames = {
      third: frame('p1', 'sale', 'a2'),
      first: frame('p1', 'Sale', 'a0'),
      story: frame('p1', 'Story', 'a1'),
      fourth: frame('p1', 'Sale', 'a3'),
      other: frame('p2', 'Sale', 'a0'),
    }
    expect([...numberedFrameNames({ frames }, 'p1')].map(([id, { name }]) => [id, name])).toEqual([
      ['first', 'Sale'],
      ['story', 'Story'],
      ['third', 'sale 2'],
      ['fourth', 'Sale 3'],
    ])
    // Another page numbers its own frames.
    expect([...numberedFrameNames({ frames }, 'p2')].map(([id, { name }]) => [id, name])).toEqual([['other', 'Sale']])
    expect(numberedFrameNames({ frames }, 'p3').size).toBe(0)
  })

  it('never gives two frames one name, even where a frame is named like a number', () => {
    const frames = {
      a: frame('p1', 'Sale 2', 'a0'),
      b: frame('p1', 'Sale', 'a1'),
      c: frame('p1', 'Sale', 'a2'),
      d: frame('p1', ' Sale ', 'a3'),
    }
    expect([...numberedFrameNames({ frames }, 'p1').values()].map(({ name }) => name)).toEqual([
      'Sale 2',
      'Sale',
      'Sale 3',
      'Sale 4',
    ])
  })

  it('keeps a name no other frame shares, numbering a repeat with the lowest number no frame has and none was given', () => {
    const frames = {
      a: frame('p1', 'Sale', 'a0'),
      b: frame('p1', 'Sale', 'a1'),
      c: frame('p1', 'Sale 2', 'a2'),
    }
    expect([...numberedFrameNames({ frames }, 'p1').values()].map(({ name }) => name)).toEqual([
      'Sale',
      'Sale 3',
      'Sale 2',
    ])
    const more = { ...frames, d: frame('p1', 'Sale', 'a3'), e: frame('p1', 'Sale 4', 'a4') }
    expect([...numberedFrameNames({ frames: more }, 'p1').values()].map(({ name }) => name)).toEqual([
      'Sale',
      'Sale 3',
      'Sale 2',
      'Sale 5',
      'Sale 4',
    ])
  })

  it('says the number it added to a name, so a list can show it apart from the frame’s own name', () => {
    const frames = {
      a: frame('p1', 'Sale', 'a0'),
      b: frame('p1', 'Sale', 'a1'),
      c: frame('p1', 'Sale 2', 'a2'),
      d: frame('p1', 'Sale/Promo', 'a3'),
    }
    expect(Object.fromEntries(numberedFrameNames({ frames }, 'p1'))).toEqual({
      a: { name: 'Sale', number: null },
      b: { name: 'Sale 3', number: 3 },
      c: { name: 'Sale 2', number: null },
      d: { name: 'Sale-Promo', number: null },
    })
  })

  it('numbers the names files take: one a file cannot hold is cleaned first, so the list and the files agree', () => {
    const frames = {
      a: frame('p1', 'Sale/Promo', 'a0'),
      b: frame('p1', 'Sale-Promo', 'a1'),
      c: frame('p1', '..', 'a2'),
      d: frame('p1', 'untitled', 'a3'),
      e: frame('p1', '. Story', 'a4'),
      f: frame('p1', 'story', 'a5'),
    }
    expect([...numberedFrameNames({ frames }, 'p1').values()].map(({ name }) => name)).toEqual([
      'Sale-Promo',
      'Sale-Promo 2',
      'untitled',
      'untitled 2',
      'Story',
      'story 2',
    ])
  })
})

describe('safeFileName', () => {
  it('makes a name every file system holds, and leaves a name it made as it is', () => {
    expect(safeFileName('Sale/Promo: 50%')).toBe('Sale-Promo- 50%')
    expect(safeFileName('  Big    sale  ')).toBe('Big sale')
    expect(safeFileName('. . Story')).toBe('Story')
    expect(safeFileName('...')).toBe('untitled')
    for (const name of ['Sale/Promo', ' . Story ', '.. x', 'a  \u0001 b'])
      expect(safeFileName(safeFileName(name))).toBe(safeFileName(name))
  })
})

describe('ExportRequest', () => {
  it('draws at 1x unless asked for 2x or 3x, and takes WebP', () => {
    const request = ExportRequest.parse({ frameIds: ['f'], type: 'webp' })
    expect(request).toMatchObject({ type: 'webp', scale: 1, quality: 90 })
    expect(ExportRequest.parse({ frameIds: ['f'], type: 'png', scale: 3 }).scale).toBe(3)
    for (const scale of [0, 4, 1.5, '2'])
      expect(ExportRequest.safeParse({ frameIds: ['f'], type: 'png', scale }).success).toBe(false)
  })
})

describe('exportFits', () => {
  it('fits a frame whose pixels at the scale are within a side and a total any browser encodes', () => {
    expect(MAX_EXPORT_SIDE).toBe(16_383)
    expect(exportFits({ width: 16_383, height: 100 }, 1)).toBe(true)
    expect(exportFits({ width: 16_384, height: 100 }, 1)).toBe(false)
    expect(exportFits({ width: 8_191, height: 100 }, 2)).toBe(true)
    expect(exportFits({ width: 8_192, height: 100 }, 2)).toBe(false)
    expect(exportFits({ width: 5_461, height: 100 }, 3)).toBe(true)
    expect(exportFits({ width: 5_462, height: 100 }, 3)).toBe(false)
    // 10,000 × 5,000 is 50 million pixels: the most there may be.
    expect(MAX_EXPORT_PIXELS).toBe(50_000_000)
    expect(exportFits({ width: 10_000, height: 5_000 }, 1)).toBe(true)
    expect(exportFits({ width: 10_000, height: 5_001 }, 1)).toBe(false)
    expect(exportFits({ width: 1_080, height: 1_920 }, 3)).toBe(true)
  })
})
