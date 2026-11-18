import { alphaOf, type Paint, withAlpha } from '@dazbee/schema'

/** How a list of paints looks in a swatch: a #RRGGBBAA colour, a rainbow (`mixed`), or empty (`none`). */
export type Swatch = string | 'mixed' | 'none'

/**
 * The swatch for a list of fills or stroke paints, as they look: the paint on top that shows, as
 * #RRGGBBAA with its colour's alpha and its own opacity, a gradient's first stop, a rainbow for an
 * image, or empty for none.
 */
export function swatchOf(paints: readonly Paint[]): Swatch {
  const top = paints.findLast((paint) => paint.visible !== false)
  if (!top) return 'none'
  const colour = top.type === 'solid' ? top.color : 'stops' in top ? top.stops[0]?.color : undefined
  return colour === undefined ? 'mixed' : withAlpha(colour, alphaOf(colour) * (top.opacity ?? 1))
}
