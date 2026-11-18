import { describe, expect, it } from 'vitest'

import { masonryPlaces, placeTiles } from './masonry.ts'

describe('placeTiles', () => {
  it('fills a row left to right before starting the next, when every tile is one shape', () => {
    const placed = placeTiles([1, 1, 1, 1, 1, 1], 4, 0.2)
    expect(placed.tiles.map((tile) => tile.column)).toEqual([0, 1, 2, 3, 0, 1])
    expect(placed.tiles.map((tile) => tile.above)).toEqual([0, 0, 0, 0, 1, 1])
    expect(placed.tiles.map((tile) => tile.count)).toEqual([0, 0, 0, 0, 1, 1])
  })

  it('puts each tile in the column that ends highest, the first of them on a tie', () => {
    // A tall story, then three squares: the third square goes under the second, not the story.
    const placed = placeTiles([1.78, 1, 1, 1], 2, 0.2)
    expect(placed.tiles.map((tile) => tile.column)).toEqual([0, 1, 1, 0])
    expect(placed.tiles.map((tile) => tile.above)).toEqual([0, 0, 1, 1.78])
  })

  it('gives each column the shapes and tiles it holds, so the list can be as tall as the tallest', () => {
    const placed = placeTiles([1.78, 1, 1, 0.33], 3, 0.2)
    expect(placed.columns).toEqual([
      { above: 1.78, count: 1 },
      { above: 1.33, count: 2 },
      { above: 1, count: 1 },
    ])
  })

  it('counts the caption rows, so a column of more, shorter tiles can end lower than one tall tile', () => {
    // A tile 2.2 tall against two squares: the squares' column ends lower once each caption row is
    // more than a fifth of the width (2 + 2 rows against 2.2 + 1 row), so the next tile goes under the tall one.
    expect(placeTiles([2.2, 1, 1, 1], 2, 0.3).tiles.map((tile) => tile.column)).toEqual([0, 1, 1, 0])
    expect(placeTiles([2.2, 1, 1, 1], 2, 0.1).tiles.map((tile) => tile.column)).toEqual([0, 1, 1, 1])
  })

  it('never makes more columns than it is given, nor fewer than one', () => {
    expect(placeTiles([1, 1], 4, 0.2).columns).toHaveLength(4)
    expect(placeTiles([1, 1], 0, 0.2).columns).toHaveLength(1)
  })
})

describe('masonryPlaces', () => {
  it('gives each tile its place for every column count the masonry takes', () => {
    const { tiles } = masonryPlaces([1, 1, 1, 1, 1, 1])
    expect(tiles.map((tile) => (tile as Record<string, number>)['--masonry-c4'])).toEqual([0, 1, 2, 3, 0, 1])
    expect(tiles.map((tile) => (tile as Record<string, number>)['--masonry-c2'])).toEqual([0, 1, 0, 1, 0, 1])
    expect(tiles[4]).toMatchObject({
      '--masonry-a4': 1,
      '--masonry-n4': 1,
      '--masonry-c5': 4,
      '--masonry-a5': 0,
      '--masonry-n5': 0,
    })
  })

  it('makes the list as tall as its tallest column, for every column count', () => {
    const end = (above: number, count: number) => `calc(${above} * var(--masonry-w) + ${count} * var(--masonry-row))`
    const { list } = masonryPlaces([1.78, 1, 1])
    expect(list).toMatchObject({
      '--masonry-h2': `max(${end(1.78, 1)}, ${end(2, 2)})`,
      '--masonry-h5': `max(${end(1.78, 1)}, ${end(1, 1)}, ${end(1, 1)})`,
    })
  })

  it('makes an empty list no height', () => {
    expect(masonryPlaces([]).list).toMatchObject({ '--masonry-h2': '0px', '--masonry-h5': '0px' })
  })
})
