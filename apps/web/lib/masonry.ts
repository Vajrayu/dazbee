/**
 * A masonry of tiles in order: each tile goes into the column that ends highest so far, the first
 * of them on a tie, so a row fills left to right before the next starts. A tile is a picture of
 * a known shape (its height over its width) with a caption row of one height under it.
 */
import type { CSSProperties } from 'react'

/** A placed tile: its column, the summed shapes of the tiles above it and how many sit above it. */
export interface PlacedTile {
  column: number
  above: number
  count: number
}

/** A column's summed shapes and tile count, which make its height. */
export interface PlacedColumn {
  above: number
  count: number
}

/**
 * The column counts the masonry takes, narrowest screen first, as styles/masonry.css switches them,
 * each with how tall a caption row (3.75rem, about 52 px) is as a share of a column's width there, to
 * tell which column ends highest: about 175 px wide on a phone, 200 to 350 px from 48rem, 300 px from
 * 80rem and 200 to 280 px from 96rem.
 */
export const MASONRY_COLUMNS = [
  { count: 2, captionShare: 0.3 },
  { count: 3, captionShare: 0.22 },
  { count: 4, captionShare: 0.18 },
  { count: 5, captionShare: 0.22 },
] as const

/**
 * Places tiles of `shapes` (height over width) in `columns` columns, at least one, a caption row
 * being `captionShare` of a column's width.
 */
export function placeTiles(
  shapes: readonly number[],
  columns: number,
  captionShare: number,
): {
  tiles: PlacedTile[]
  columns: PlacedColumn[]
} {
  const placed: PlacedColumn[] = Array.from({ length: Math.max(1, columns) }, () => ({ above: 0, count: 0 }))
  const height = (column: PlacedColumn) => column.above + column.count * captionShare
  const tiles = shapes.map((shape) => {
    let at = 0
    for (let i = 1; i < placed.length; i++)
      if (height(placed[i] as PlacedColumn) < height(placed[at] as PlacedColumn)) at = i
    const column = placed[at] as PlacedColumn
    const tile = { column: at, above: column.above, count: column.count }
    column.above += shape
    column.count += 1
    return tile
  })
  return { tiles, columns: placed }
}

/**
 * The places of tiles of `shapes` for each column count, as the custom properties styles/masonry.css
 * reads: on each tile `--masonry-c<n>` (its column), `--masonry-a<n>` (the shapes above it) and
 * `--masonry-n<n>` (the tiles above it); on the list `--masonry-h<n>`, its tallest column, in terms of
 * a column's width `--masonry-w` and a tile's caption row `--masonry-row`.
 */
export function masonryPlaces(shapes: readonly number[]): { list: CSSProperties; tiles: CSSProperties[] } {
  const list: Record<string, string> = {}
  const tiles: Record<string, number>[] = shapes.map(() => ({}))
  for (const { count, captionShare } of MASONRY_COLUMNS) {
    const placed = placeTiles(shapes, count, captionShare)
    placed.tiles.forEach((tile, i) => {
      Object.assign(tiles[i] as Record<string, number>, {
        [`--masonry-c${count}`]: tile.column,
        [`--masonry-a${count}`]: tidy(tile.above),
        [`--masonry-n${count}`]: tile.count,
      })
    })
    const ends = placed.columns
      .filter((column) => column.count > 0)
      .map((column) => `calc(${tidy(column.above)} * var(--masonry-w) + ${column.count} * var(--masonry-row))`)
    list[`--masonry-h${count}`] = ends.length > 0 ? `max(${ends.join(', ')})` : '0px'
  }
  return { list: list as CSSProperties, tiles: tiles as CSSProperties[] }
}

/** A sum of shapes to four places, so a style holds no float noise. */
function tidy(n: number) {
  return Number(n.toFixed(4))
}
