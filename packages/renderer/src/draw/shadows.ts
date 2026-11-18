// Drop shadows, glows and inner shadows, cast from what the layer draws. A spread follows the
// layer's outline where the layer is drawn as one: the outline is grown or shrunk by
// a mitred stroke, drawn, never worked out by path ops, which are slow on big paths. Its curves
// are stroked as fine polylines, as Skia leaves a hole in a curve stroked wider than it is round.
// Any other layer spreads its pixels, a square neighbourhood at a time. `shadow-hiding.ts` hides a
// drop shadow or glow behind its layer.
import type { Canvas, CanvasKit, ImageFilter, Path, PathBuilder } from '@dazbee/canvaskit'
import type { Flips } from '@dazbee/doc'
import type { DropShadow, ImagePaint, InnerShadow, Paint, Rect, Stroke } from '@dazbee/schema'

import { color } from '../color.ts'
import { imageSizeOf, type Resources } from '../resources.ts'
import type { SceneLayer } from '../scene.ts'
import { imageBeyond, paintFor } from './paint.ts'
import { booleanPath, boxPath, shapePath } from './paths.ts'
import { sigma, SPREAD_MITER_LIMIT } from './reach.ts'
import { strokePath } from './strokes.ts'

/** What a drop shadow or a glow (at 0, 0) casts with. */
export type CastShadow = Pick<DropShadow, 'x' | 'y' | 'blur' | 'spread' | 'color'>

/** The props a layer drawn as one outline paints it with. */
export type Outlined = Rect & Flips & { fills: readonly Paint[]; strokes: readonly Stroke[] }

/** A layer drawn as one outline: its props, and the path it is filled and stroked along, built when asked. */
export interface Outline {
  props: Outlined
  path: () => Path
}

/** How a path is turned into a polyline for a spread to stroke. */
interface Flattening {
  /** Whether each open contour is closed, as filling the path closes it. */
  close: boolean
  /** Half the width the polyline is stroked at: the wider, the finer, as its mitred joins stray further. */
  half: number
  /** How far each open contour's ends are carried on along their own direction, as a spread butt end reaches. */
  extend: number
}

/** Opaque white, for the coverage a cast is drawn as before its paints' alpha is laid over it. */
export const OPAQUE = '#FFFFFFFF'

/**
 * How far, in design pixels, a curve flattened for a spread strays from it at most, and a mitred
 * join of the polyline's stroke from the curve's own: a screen pixel at the deepest zoom.
 */
const FLATNESS = 1 / 64

/**
 * Draws a drop shadow, or a glow as one at 0, 0, of what `content` draws, in the layer's offscreen
 * `bounds`. A spread on a layer drawn as one outline grows that outline, or shrinks it when it has
 * no visible strokes, and the cast holds the layer's paints' alpha: a translucent fill casts as
 * strong a shadow at any spread. Spread 0, and any other layer, casts from its pixels.
 */
export function drawDropShadow(
  ck: CanvasKit,
  canvas: Canvas,
  layer: SceneLayer,
  effect: CastShadow,
  bounds: Float32Array,
  content: () => void,
  resources: Resources,
) {
  const outline = spreadOutline(ck, layer, resources)
  const stroked = outline !== null && visibleStrokes(outline.props).length > 0
  if (!outline || effect.spread === 0 || (effect.spread < 0 && stroked)) {
    withFilter(ck, canvas, dropShadow(ck, effect), bounds, content)
    return
  }
  const path = outline.path()
  // Shrunk by half its shorter side or more, the outline is gone and casts nothing.
  if (!shrunkAway(path, -effect.spread))
    withFilter(ck, canvas, dropShadow(ck, { ...effect, spread: 0 }), bounds, () =>
      drawSpreadCast(ck, canvas, outline.props, path, effect.spread, bounds, resources),
    )
  path.delete()
}

/**
 * Draws an inner shadow over what `content` draws, kept inside it. A layer drawn as one outline
 * with no visible strokes casts it from outside that outline, so a translucent fill is shadowed
 * along its edges only; any other casts from outside its pixels, as one with an opaque fill does at
 * spread 0, where its pixels are its outline.
 */
export function drawInnerShadow(
  ck: CanvasKit,
  canvas: Canvas,
  layer: SceneLayer,
  effect: InnerShadow,
  bounds: Float32Array,
  content: () => void,
  resources: Resources,
) {
  const outline = spreadOutline(ck, layer, resources)
  const opaque = outline?.props.fills.some((p) => opaquePaint(ck, p, resources))
  if (!outline || visibleStrokes(outline.props).length > 0 || (effect.spread === 0 && opaque)) {
    withFilter(ck, canvas, innerShadow(ck, effect), bounds, content)
    return
  }
  const path = outline.path()
  canvas.saveLayer(undefined, bounds)
  // Cast from outside the outline shrunk by the spread: from everywhere once it is shrunk away.
  withFilter(ck, canvas, inward(ck, effect, null), bounds, () => {
    if (shrunkAway(path, effect.spread)) return
    const cast = coverage(ck)
    canvas.drawPath(path, cast)
    cast.delete()
    if (effect.spread > 0) drawBand(ck, canvas, path, effect.spread, true)
  })
  // Kept where the content is, by a layer of it: a PDF draws a DstIn layer as the CPU does.
  const keep = new ck.Paint()
  keep.setBlendMode(ck.BlendMode.DstIn)
  canvas.saveLayer(keep, bounds)
  keep.delete()
  content()
  canvas.restore()
  canvas.restore()
  path.delete()
}

/** Draws what `draw` draws through an image filter, in an offscreen layer as big as `bounds`. */
export function withFilter(
  ck: CanvasKit,
  canvas: Canvas,
  filter: ImageFilter,
  bounds: Float32Array | null,
  draw: () => void,
) {
  const paint = new ck.Paint()
  paint.setImageFilter(filter)
  canvas.saveLayer(paint, bounds)
  draw()
  canvas.restore()
  paint.delete()
  filter.delete()
}

/**
 * The outline a layer is drawn as, which its shadows spread along; null for a layer whose pixels
 * they spread instead. A graphic other than a line, a boolean, a box with no children or one that
 * clips them over an opaque fill are drawn as their outline, unless a stroke is dashed or an image
 * paint has alpha (decoded with it, as a PNG is) or leaves part of the box clear.
 */
export function spreadOutline(ck: CanvasKit, layer: SceneLayer, resources: Resources): Outline | null {
  if (layer.type === 'text' || layer.type === 'group') return null
  if (layer.type === 'graphic' && layer.props.shape.kind === 'line') return null
  const { props } = layer
  const strokes = visibleStrokes(props)
  if (strokes.some((s) => s.dashes.length > 0)) return null
  const paints = [...props.fills, ...strokes.map((s) => s.paint)]
  if (paints.some((p) => p.type === 'image' && p.visible !== false && !opaqueImage(ck, p, resources))) return null
  if (layer.type === 'box') {
    const box = layer.props
    const covered = box.clip && box.fills.some((p) => opaquePaint(ck, p, resources))
    if (layer.children.length > 0 && !covered) return null
    return { props, path: () => boxPath(ck, box) }
  }
  return { props, path: () => (layer.type === 'graphic' ? shapePath(ck, layer) : booleanPath(ck, layer)) }
}

/** The strokes of a layer drawn as one outline that show. */
export function visibleStrokes(props: Outlined): Stroke[] {
  return props.strokes.filter((s) => s.paint.visible !== false)
}

/** Whether a paint shows opaque all over: no alpha in its colours, its own opacity full. */
export function opaquePaint(ck: CanvasKit, paint: Paint, resources: Resources) {
  if (paint.visible === false || (paint.opacity ?? 1) < 1) return false
  switch (paint.type) {
    case 'solid':
      return opaqueHex(paint.color)
    case 'linear':
    case 'radial':
    case 'angular':
      return paint.stops.every((s) => opaqueHex(s.color))
    case 'image':
      return opaqueImage(ck, paint, resources)
  }
}

/** Whether a #RRGGBBAA colour is opaque. */
export function opaqueHex(hex: string) {
  return hex.slice(7).toUpperCase() === 'FF'
}

function dropShadow(ck: CanvasKit, effect: CastShadow) {
  const spread =
    effect.spread > 0
      ? ck.ImageFilter.MakeDilate(effect.spread, effect.spread, null)
      : effect.spread < 0
        ? ck.ImageFilter.MakeErode(-effect.spread, -effect.spread, null)
        : null
  const shadow = ck.ImageFilter.MakeDropShadowOnly(
    effect.x,
    effect.y,
    sigma(effect.blur),
    sigma(effect.blur),
    color(ck, effect.color),
    spread,
  )
  spread?.delete()
  return shadow
}

/**
 * Whether shrinking `path` by `by` leaves nothing of it: by half its box's shorter side or more,
 * as every point inside lies at most that far from the box's edge, so from the path's.
 */
function shrunkAway(path: Path, by: number) {
  if (by <= 0) return false
  const [left = 0, top = 0, right = 0, bottom = 0] = path.computeTightBounds()
  return by >= Math.min(right - left, bottom - top) / 2
}

/**
 * The drop shadow's cast of a layer drawn as one outline, spread: its fills' outline grown, or
 * shrunk, with their alpha, then each visible stroke's area grown, with its paint's alpha.
 */
function drawSpreadCast(
  ck: CanvasKit,
  canvas: Canvas,
  props: Outlined,
  path: Path,
  spread: number,
  bounds: Float32Array,
  resources: Resources,
) {
  const fills = props.fills.filter((p) => p.visible !== false)
  if (fills.length > 0) {
    const paint = coverage(ck)
    canvas.drawPath(path, paint)
    paint.delete()
    drawBand(ck, canvas, path, Math.abs(spread), spread < 0)
    keepPaints(ck, canvas, fills, props, bounds, resources)
  }
  for (const stroke of visibleStrokes(props)) {
    canvas.saveLayer(undefined, bounds)
    // As the stroke is drawn, `spread` wider on each side: past the outline on the side it is
    // drawn on, and `spread` onto the other.
    const grown =
      stroke.align === 'center'
        ? [{ ...stroke, width: stroke.width + 2 * spread }]
        : [
            { ...stroke, width: stroke.width + spread },
            { ...stroke, align: 'center' as const, width: 2 * spread },
          ]
    const area = grown.map((s) => ({ ...s, paint: { type: 'solid' as const, color: OPAQUE }, dashes: [] }))
    // A butt end reaches `spread` past the end, as the stroke's sides do past them.
    const along = polyline(ck, path, {
      close: false,
      half: stroke.width + spread,
      extend: stroke.cap === 'butt' ? spread : 0,
    })
    strokePath(ck, canvas, along, { ...props, strokes: area }, resources, null)
    along.delete()
    keepPaints(ck, canvas, [stroke.paint], props, bounds, resources)
    canvas.restore()
  }
}

/** An inner shadow of the layer's pixels: cast inward from outside them, grown by the spread, and kept where they are. */
function innerShadow(ck: CanvasKit, effect: InnerShadow) {
  const blurred = inward(ck, effect, (colored) => ck.ImageFilter.MakeDilate(effect.spread, effect.spread, colored))
  const inside = ck.ImageFilter.MakeBlend(ck.BlendMode.SrcIn, null, blurred)
  blurred.delete()
  return inside
}

/**
 * What an inner shadow casts from a drawing: everything outside it, coloured, spread by `spread`
 * when given and the effect has a spread, moved and blurred. The colour matrix turns transparent
 * into the shadow colour and opaque into nothing, working on unpremultiplied values in 0 to 1.
 */
function inward(ck: CanvasKit, effect: InnerShadow, spread: ((colored: ImageFilter) => ImageFilter) | null) {
  const [r = 0, g = 0, b = 0, a = 0] = color(ck, effect.color)
  const outside = ck.ColorFilter.MakeMatrix([0, 0, 0, 0, r, 0, 0, 0, 0, g, 0, 0, 0, 0, b, 0, 0, 0, -a, a])
  const colored = ck.ImageFilter.MakeColorFilter(outside, null)
  outside.delete()
  const spreadOut = spread && effect.spread > 0 ? spread(colored) : colored
  const moved = ck.ImageFilter.MakeOffset(effect.x, effect.y, spreadOut)
  const blurred = ck.ImageFilter.MakeBlur(sigma(effect.blur), sigma(effect.blur), ck.TileMode.Decal, moved)
  for (const f of new Set([colored, spreadOut, moved])) f.delete()
  return blurred
}

/** An opaque anti-aliased fill, for coverage. */
function coverage(ck: CanvasKit) {
  const paint = new ck.Paint()
  paint.setAntiAlias(true)
  paint.setColor(ck.WHITE)
  return paint
}

/**
 * Draws the band within `half` of an outline, mitred at its corners up to SPREAD_MITER_LIMIT:
 * added to what is drawn, or cleared from it to `shrink` the shape. Every contour is closed first,
 * so an open path grows past the edge its fill closes it by, and flattened, so no curve leaves a
 * hole. A shrinking outline is simplified first, so the edges of contours that overlap, inside the
 * shape, cut nothing away.
 */
function drawBand(ck: CanvasKit, canvas: Canvas, path: Path, half: number, shrink: boolean) {
  const closed = polyline(ck, path, { close: true, half, extend: 0 })
  const simplified = shrink ? simplify(ck, closed) : null
  const paint = coverage(ck)
  paint.setStyle(ck.PaintStyle.Stroke)
  paint.setStrokeWidth(2 * half)
  paint.setStrokeJoin(ck.StrokeJoin.Miter)
  paint.setStrokeMiter(SPREAD_MITER_LIMIT)
  if (shrink) paint.setBlendMode(ck.BlendMode.Clear)
  canvas.drawPath(simplified ?? closed, paint)
  paint.delete()
  simplified?.delete()
  closed.delete()
}

/** Whether an image paint is opaque all over its box: an image decoded opaque that covers it, or tiles it. */
function opaqueImage(ck: CanvasKit, fill: ImagePaint, resources: Resources) {
  const image = resources.images.get(fill.assetId)
  if (!image || image.getImageInfo().alphaType !== ck.AlphaType.Opaque) return false
  const beyond = imageBeyond(imageSizeOf(resources, fill.assetId, image), fill)
  return beyond.x !== 'clear' && beyond.y !== 'clear'
}

/**
 * Keeps what the canvas's current layer holds only as far as `paints`, laid over each other, are
 * opaque, all across the layer: so a spread band holds the alpha of the paints at its edge. Paints
 * that are opaque all over change nothing and are skipped.
 */
function keepPaints(
  ck: CanvasKit,
  canvas: Canvas,
  paints: readonly Paint[],
  box: Rect & Flips,
  bounds: Float32Array,
  resources: Resources,
) {
  if (paints.some((p) => opaquePaint(ck, p, resources))) return
  const keep = new ck.Paint()
  keep.setBlendMode(ck.BlendMode.SrcIn)
  canvas.saveLayer(keep, bounds)
  keep.delete()
  for (const p of paints) {
    const paint = paintFor(ck, p, box, resources)
    if (!paint) continue
    canvas.drawPaint(paint)
    paint.delete()
  }
  canvas.restore()
}

/**
 * The path as straight lines, each curve cut into segments fine enough for a stroke `half` wide
 * each side, each open contour closed or carried on at its ends as `how` says; its fill rule kept.
 */
function polyline(ck: CanvasKit, path: Path, how: Flattening): Path {
  const cmds = path.toCmds()
  const builder = new ck.PathBuilder()
  let contour: number[] = []
  const end = (closed: boolean) => {
    addContour(builder, contour, closed || how.close, how.extend)
    contour = []
  }
  for (let i = 0; i < cmds.length;) {
    const verb = cmds[i]
    const at = (n: number) => cmds[i + n] ?? 0
    const from = contour.slice(-2)
    if (verb === ck.MOVE_VERB) {
      if (contour.length > 0) end(false)
      contour.push(at(1), at(2))
      i += 3
    } else if (verb === ck.LINE_VERB) {
      contour.push(at(1), at(2))
      i += 3
    } else if (verb === ck.QUAD_VERB) {
      flatten(contour, [...from, at(1), at(2), at(3), at(4)], 1, how.half)
      i += 5
    } else if (verb === ck.CONIC_VERB) {
      flatten(contour, [...from, at(1), at(2), at(3), at(4)], at(5), how.half)
      i += 6
    } else if (verb === ck.CUBIC_VERB) {
      flatten(contour, [...from, at(1), at(2), at(3), at(4), at(5), at(6)], 1, how.half)
      i += 7
    } else {
      // A close: a contour drawn on with no move first starts where this one did.
      const start = contour.slice(0, 2)
      end(true)
      if (i + 1 < cmds.length && cmds[i + 1] !== ck.MOVE_VERB) contour.push(...start)
      i += 1
    }
  }
  if (contour.length > 0) end(false)
  builder.setFillType(path.getFillType())
  return builder.detachAndDelete()
}

/**
 * The path as contours that don't overlap, covering what it fills: its union with nothing, as
 * this CanvasKit build binds no simplify of its own. Null when the path ops fail.
 */
function simplify(ck: CanvasKit, path: Path): Path | null {
  const empty = new ck.PathBuilder().detachAndDelete()
  const simplified = ck.Path.MakeFromOp(path, empty, ck.PathOp.Union)
  empty.delete()
  return simplified
}

/**
 * Adds a contour of points, x then y, to `builder`: closed, or open with its ends carried on
 * `extend` along their own direction. A contour of one point adds nothing.
 */
function addContour(builder: PathBuilder, points: number[], closed: boolean, extend: number) {
  if (points.length < 4) return
  const xy = (i: number) => [points[2 * i] ?? 0, points[2 * i + 1] ?? 0] as const
  const last = points.length / 2 - 1
  // Out from an end, away from the nearest point that isn't on it.
  const past = (end: number, step: number) => {
    const [ex, ey] = xy(end)
    for (let i = end + step; i >= 0 && i <= last; i += step) {
      const [x, y] = xy(i)
      const length = Math.hypot(ex - x, ey - y)
      if (length > 0) return [ex + ((ex - x) / length) * extend, ey + ((ey - y) / length) * extend]
    }
    return []
  }
  const carried = closed || extend <= 0 ? points : [...past(0, 1), ...points, ...past(last, -1)]
  builder.moveTo(carried[0] ?? 0, carried[1] ?? 0)
  for (let i = 2; i < carried.length; i += 2) builder.lineTo(carried[i] ?? 0, carried[i + 1] ?? 0)
  if (closed) builder.close()
}

/**
 * Adds the points of a curve, after its first, to `contour`: a quad or a conic of weight `weight`
 * (three control points), or a cubic (four), x then y. It is cut into as many even steps as keep
 * the points within FLATNESS of the curve (Wang's bound, scaled up by a conic's weight above 1),
 * and the mitred joins of a stroke `half` wide each side within FLATNESS of the curve's own edge:
 * a join turning by a reaches about half × a² / 8 past it, and the curve turns no further than its
 * control points do.
 */
function flatten(contour: number[], control: number[], weight: number, half: number) {
  const count = control.length / 2
  const p = (i: number) => [control[2 * i] ?? 0, control[2 * i + 1] ?? 0] as const
  let bend = 0
  for (let i = 0; i + 2 < count; i++) {
    const [[ax, ay], [bx, by], [cx, cy]] = [p(i), p(i + 1), p(i + 2)]
    bend = Math.max(bend, Math.hypot(ax - 2 * bx + cx, ay - 2 * by + cy))
  }
  let turn = 0
  let heading: number | null = null
  for (let i = 0; i + 1 < count; i++) {
    const [[ax, ay], [bx, by]] = [p(i), p(i + 1)]
    if (ax === bx && ay === by) continue
    const next = Math.atan2(by - ay, bx - ax)
    if (heading !== null) turn += Math.abs(Math.atan2(Math.sin(next - heading), Math.cos(next - heading)))
    heading = next
  }
  const degree = count - 1
  const wang = Math.sqrt((((degree * (degree - 1)) / 8) * bend * Math.max(1, weight)) / FLATNESS)
  const joins = turn * Math.sqrt(half / (8 * FLATNESS))
  const steps = Math.min(4096, Math.max(1, Math.ceil(Math.max(wang, joins))))
  for (let k = 1; k <= steps; k++) contour.push(...pointOn(control, weight, k / steps))
}

/** The point at `t` along a quad, a conic of weight `weight` or a cubic, given by its control points. */
function pointOn(control: number[], weight: number, t: number): [number, number] {
  const c = (i: number) => control[i] ?? 0
  const u = 1 - t
  if (control.length === 8) {
    const [a, b, d, e] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t]
    return [a * c(0) + b * c(2) + d * c(4) + e * c(6), a * c(1) + b * c(3) + d * c(5) + e * c(7)]
  }
  const [a, b, d] = [u * u, 2 * weight * u * t, t * t]
  const total = a + b + d
  return [(a * c(0) + b * c(2) + d * c(4)) / total, (a * c(1) + b * c(3) + d * c(5)) / total]
}
