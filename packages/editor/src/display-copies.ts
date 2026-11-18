// Display copies: the screen draws each image from a copy no bigger than it is shown,
// in steps, and the image itself only when it is shown bigger than the last step. A copy is made
// when the screen first needs the image, by the size the image is drawn on the shown page, and a
// bigger one once a zoom past its side has settled. In the browser the image worker decodes and
// shrinks them, so no photo is decoded on the main thread; headless, they are made here at once.
// Exports never use them: they decode the originals from the bytes.
import type { CanvasKit, Image } from '@dazbee/canvaskit'
import { imagePlacement, type ImageSize, type Scene, type SceneLayer } from '@dazbee/renderer'
import { type ImagePaint, MAX_IMAGE_SIDE } from '@dazbee/schema'

/** Where an image is drawn: the fill, and the size of the box it fills. */
export interface ImageUse {
  fill: ImagePaint
  box: ImageSize
}

/**
 * A display copy made elsewhere: its pixels, premultiplied RGBA row by row, the image's own size,
 * and whether the image decodes opaque (a JPEG), which its copy keeps: shadows spread an opaque
 * photo by its layer's outline, as exports do.
 */
export interface MadeCopy {
  width: number
  height: number
  pixels: Uint8Array
  own: ImageSize
  opaque: boolean
}

/**
 * Makes a display copy away from the main thread: of the encoded image, `side` pixels on its long
 * side or the image's own size when that is smaller; null when the bytes don't decode. It rejects
 * when what makes it failed (a worker that ended), which says nothing of the image.
 */
export type CopyMaker = (bytes: Uint8Array, side: number) => Promise<MadeCopy | null>

/** What a maker rejects a copy with when it was lost to another image's failure: nothing is held against this one. */
export class CopyLost extends Error {
  override name = 'CopyLost'
}

/** What the display copies are made from and tell. */
export interface DisplayCopiesDeps {
  ck: CanvasKit
  /** An image's stored bytes, by asset id; undefined while they are still coming. */
  encoded: (assetId: string) => Uint8Array | undefined
  /** Told when copies were made or made again, after the screen asked for them. */
  changed: () => void
  /** Told of an image whose bytes didn't decode, or whose copy couldn't be made, once: it is never tried again. */
  failed?: ((assetId: string) => void) | undefined
  /** Makes the copies away from the main thread; without it they are made at once, here. */
  maker?: CopyMaker | undefined
  /** Runs `run` after `ms`, and gives what cancels it; without it a bigger copy is made at the next draw. */
  after?: ((ms: number, run: () => void) => () => void) | undefined
  /** The longest side a copy may have, such as the GPU's largest texture. */
  maxSide?: number
  /** The bytes the copies may hold, counted by `heldBytes`, before those drawn longest ago are let go. */
  budget?: number
}

export interface DisplayCopies {
  /** The images to draw, by asset id, copies or the images themselves; a new map whenever one changes. */
  images(): ReadonlyMap<string, Image>
  /** The own size of each image drawn from a smaller copy, by asset id; a new map with `images`. */
  sizes(): ReadonlyMap<string, ImageSize>
  /**
   * Says where the shown page draws its images and how many device pixels a design pixel takes
   * (zoom × device pixel ratio). An image drawn past its copy's side gets a bigger copy once this
   * has stayed so for SETTLE_MS.
   */
  show(uses: ReadonlyMap<string, readonly ImageUse[]>, pixelsPerUnit: number): void
  /**
   * Makes the copies of these images whose bytes are here and that have none yet, or asks the maker
   * for them, which tells `changed` when they come. Whether any was made at once.
   */
  make(assetIds: readonly string[]): boolean
  destroy(): void
}

/** The long sides a copy is made at, smallest first; past the last the image itself is drawn. */
export const COPY_SIDES = [1024, 2048, 4096] as const
/** How long the size an image is drawn at stays put before a bigger copy is made: a zoom settling. */
export const SETTLE_MS = 200
/** The bytes the screen's copies may hold, by `heldBytes`, before the ones drawn longest ago are let go. */
export const COPIES_BUDGET = 512 * 1024 * 1024

/** How many times making an image's copy may end the maker before the image is taken as failed. */
const MOST_CRASHES = 2

/** The size taken for an image whose own size isn't known yet: as big as can be, so the copy's step decides. */
const UNKNOWN: ImageSize = { width: Number.MAX_SAFE_INTEGER, height: Number.MAX_SAFE_INTEGER }

export function displayCopies({
  ck,
  encoded,
  changed,
  failed: told = () => {},
  maker,
  after,
  maxSide = MAX_IMAGE_SIDE,
  budget = COPIES_BUDGET,
}: DisplayCopiesDeps): DisplayCopies {
  /** The copy of each image: what is drawn, its long side, and the image's own size. */
  const held = new Map<string, { image: Image; side: number; own: ImageSize }>()
  /** Images that didn't decode, or whose copy couldn't be made at a side, never tried again. */
  const failed = new Set<string>()
  /** The side asked of the maker for each image whose copy is on its way, one at a time. */
  const asked = new Map<string, number>()
  /** How many times asking for each image's copy ended with the maker failing. */
  const crashes = new Map<string, number>()
  let images: ReadonlyMap<string, Image> = new Map()
  let sizes: ReadonlyMap<string, ImageSize> = new Map()
  /** Whether `held` changed since `images` and `sizes` were made: copies coming together change them once. */
  let stale = false
  let destroyed = false
  let uses: ReadonlyMap<string, readonly ImageUse[]> = new Map()
  let pixelsPerUnit = 1
  /** When each image was last drawn, by the count of `show` calls: the copies drawn longest ago are let go first. */
  const lastDrawn = new Map<string, number>()
  let shows = 0
  /**
   * Images whose copies were let go: made again when the shown page draws them, and for a page's
   * thumbnail only when the smallest copy fits the budget beside those held and on their way.
   */
  const letGo = new Set<string>()
  /** The own size of each image ever held, which tells what a copy of it made again will cost. */
  const owns = new Map<string, ImageSize>()
  /** Cancels the wait before bigger copies are made, while one runs, with the sides it waits to make. */
  let waiting: { cancel: () => void; sides: string } | null = null

  /** The side of the copy an image wants now: by where it is drawn, the smallest step when nowhere. */
  function wanted(assetId: string, own: ImageSize) {
    return copySide(own, drawnSide(own, uses.get(assetId) ?? [], pixelsPerUnit), maxSide)
  }

  function make(assetIds: readonly string[]) {
    let made = false
    for (const assetId of assetIds) {
      // Asked for by the stage or a page's thumbnail: drawn now, so let go after earlier pages' copies.
      lastDrawn.set(assetId, shows)
      if (held.has(assetId) || failed.has(assetId) || asked.has(assetId)) continue
      if (letGo.has(assetId) && !uses.has(assetId) && !fits(assetId)) continue
      const bytes = encoded(assetId)
      if (!bytes) continue
      letGo.delete(assetId)
      if (maker) {
        ask(assetId, bytes, copySide(UNKNOWN, boxSide(uses.get(assetId) ?? [], pixelsPerUnit), maxSide))
        continue
      }
      const image = ck.MakeImageFromEncoded(bytes)
      const own = image && { width: image.width(), height: image.height() }
      // A bad file draws nothing.
      if (image && own && hold(assetId, image, own, wanted(assetId, own))) made = true
      else fail(assetId)
    }
    trim()
    return made
  }

  /**
   * Asks the maker for a copy `side` long, which is held and told of when it comes. Its own size
   * isn't known before, so a first copy is sized by the boxes the image fills.
   */
  function ask(assetId: string, bytes: Uint8Array, side: number) {
    if (!maker) return
    asked.set(assetId, side)
    const done = (copy: MadeCopy | null) => {
      asked.delete(assetId)
      if (destroyed) return
      const image = copy && ck.MakeImage(pixelInfo(ck, copy, copy.opaque), copy.pixels, copy.width * 4)
      if (!copy || !image) return fail(assetId)
      held.get(assetId)?.image.delete()
      held.set(assetId, { image, side: Math.min(side, Math.max(copy.own.width, copy.own.height)), own: copy.own })
      owns.set(assetId, copy.own)
      stale = true
      trim()
      changed()
    }
    /** The maker failed, maybe on this image: the next draw asks again, unless this image ended it before. */
    const crashed = (error: unknown) => {
      asked.delete(assetId)
      if (destroyed || error instanceof CopyLost) return
      const times = (crashes.get(assetId) ?? 0) + 1
      crashes.set(assetId, times)
      if (times >= MOST_CRASHES) fail(assetId)
    }
    // A maker that throws at once (a worker the page may not start) fails the same way.
    let making: Promise<MadeCopy | null>
    try {
      making = maker(bytes, side)
    } catch (error) {
      making = Promise.reject(error)
    }
    making.then(done, crashed)
  }

  function show(next: ReadonlyMap<string, readonly ImageUse[]>, ppu: number) {
    uses = next
    pixelsPerUnit = ppu
    shows++
    for (const assetId of uses.keys()) lastDrawn.set(assetId, shows)
    trim()
    const grow = [...held]
      .filter(([assetId, { side, own }]) => !failed.has(assetId) && !asked.has(assetId) && wanted(assetId, own) > side)
      .map(([assetId, { own }]) => `${assetId}@${wanted(assetId, own)}`)
    if (grow.length === 0) {
      waiting?.cancel()
      waiting = null
      return
    }
    if (!after) return void growCopies()
    // A redraw that wants the same sides (another tab's edit, a font arriving) keeps the wait.
    const sides = grow.join('\n')
    if (waiting?.sides === sides) return
    waiting?.cancel()
    const cancel = after(SETTLE_MS, () => {
      waiting = null
      if (growCopies()) changed()
    })
    waiting = { cancel, sides }
  }

  /** Makes bigger copies of the images drawn past their copies' sides, or asks for them; whether any was made at once. */
  function growCopies() {
    let grown = false
    for (const [assetId, { side, own }] of [...held]) {
      const next = wanted(assetId, own)
      const bytes = encoded(assetId)
      if (next <= side || !bytes || failed.has(assetId) || asked.has(assetId)) continue
      if (maker) {
        ask(assetId, bytes, next)
        continue
      }
      const image = ck.MakeImageFromEncoded(bytes)
      if (image && hold(assetId, image, own, next)) grown = true
      else fail(assetId)
    }
    trim()
    return grown
  }

  /**
   * Keeps `image`'s copy at `side` in place of the one held, freeing that one and the decoded
   * image; whether the copy could be made (a surface that big may not be).
   */
  function hold(assetId: string, image: Image, own: ImageSize, side: number) {
    let copy: Image
    try {
      copy = copyOf(ck, image, side)
    } catch {
      image.delete()
      return false
    }
    if (copy !== image) image.delete()
    held.get(assetId)?.image.delete()
    held.set(assetId, { image: copy, side, own })
    owns.set(assetId, own)
    stale = true
    return true
  }

  /**
   * Whether the smallest copy of an image let go fits the budget beside the copies held and those
   * on their way: one made past it would let go of another, and that one of the next.
   */
  function fits(assetId: string) {
    const own = owns.get(assetId)
    if (!own) return true
    let total = copyBytes(own, copySide(own, 0, maxSide))
    for (const { image } of held.values()) total += heldBytes(image)
    for (const [id, side] of asked) {
      const coming = owns.get(id)
      if (coming) total += copyBytes(coming, side)
    }
    return total <= budget
  }

  /**
   * Lets go of the copies drawn longest ago until those held fit the budget. A copy the shown page
   * draws is never let go, so panning never draws an image clear: when the page alone needs more
   * than the budget, it is held anyway.
   */
  function trim() {
    let total = 0
    for (const { image } of held.values()) total += heldBytes(image)
    if (total <= budget) return
    const off = [...held]
      .filter(([assetId]) => !uses.has(assetId))
      .sort(([a], [b]) => (lastDrawn.get(a) ?? 0) - (lastDrawn.get(b) ?? 0))
    for (const [assetId, { image }] of off) {
      if (total <= budget) break
      total -= heldBytes(image)
      image.delete()
      held.delete(assetId)
      letGo.add(assetId)
      // One that couldn't be made bigger may be, made again.
      failed.delete(assetId)
      stale = true
    }
  }

  /**
   * Takes an image as failed, never tried again: one with no copy draws nothing, and the status
   * says so once; one that couldn't be made bigger keeps the copy it has, quietly.
   */
  function fail(assetId: string) {
    failed.add(assetId)
    if (!held.has(assetId)) told(assetId)
  }

  /** Makes `images` and `sizes` again when a copy changed since they were made. */
  function publish() {
    if (!stale) return
    stale = false
    images = new Map([...held].map(([assetId, { image }]) => [assetId, image]))
    sizes = new Map(
      [...held]
        .filter(([, { image, own }]) => image.width() !== own.width || image.height() !== own.height)
        .map(([assetId, { own }]) => [assetId, own]),
    )
  }

  function destroy() {
    destroyed = true
    waiting?.cancel()
    for (const { image } of held.values()) image.delete()
    held.clear()
    images = new Map()
    sizes = new Map()
  }

  return {
    images: () => {
      publish()
      return images
    },
    sizes: () => {
      publish()
      return sizes
    },
    show,
    make,
    destroy,
  }
}

/**
 * What a held copy costs: its pixels in wasm memory and its texture on the GPU, mipmaps and all
 * (w × h × 4 × 4/3), about 7/3 of its pixels.
 */
export function heldBytes(image: Image): number {
  return pixelBytes(image.width(), image.height())
}

/**
 * The long side of the copy to draw an image from, drawn `drawn` device pixels on its long side:
 * the smallest step at least that, or the image's own long side when that is smaller or the image
 * is drawn past the last step, never past `maxSide`.
 */
export function copySide(own: ImageSize, drawn: number, maxSide = MAX_IMAGE_SIDE): number {
  const long = Math.max(own.width, own.height)
  const step = COPY_SIDES.find((side) => side >= drawn) ?? long
  return Math.min(long, step, maxSide)
}

/** The long side, in device pixels, the whole image is drawn at by the largest of its uses; 0 for none. */
export function drawnSide(own: ImageSize, uses: readonly ImageUse[], pixelsPerUnit: number): number {
  let side = 0
  for (const { fill, box } of uses) {
    const rect = imagePlacement(own, fill, { x: 0, y: 0, ...box })
    side = Math.max(side, rect.width, rect.height)
  }
  return side * pixelsPerUnit
}

/**
 * The long side, in device pixels, of the largest box an image fills on the shown page: what it is
 * drawn at before its own size is known, exact for fit and close for fill.
 */
export function boxSide(uses: readonly ImageUse[], pixelsPerUnit: number): number {
  let side = 0
  for (const { box } of uses) side = Math.max(side, box.width, box.height)
  return side * pixelsPerUnit
}

/** The images a scene draws, by asset id, each with where: the frame's own fills and every layer's paints. */
export function imageUses(scenes: readonly Scene[]): Map<string, ImageUse[]> {
  const uses = new Map<string, ImageUse[]>()
  for (const scene of scenes) {
    for (const [assetId, sceneUses] of usesOf(scene)) uses.set(assetId, [...(uses.get(assetId) ?? []), ...sceneUses])
  }
  return uses
}

/**
 * A copy of `image` whose long side is `side`, shrunk with nearest mipmaps, opaque when the image
 * is; the image itself when it is no bigger.
 */
export function copyOf(ck: CanvasKit, image: Image, side: number): Image {
  const shrunk = shrink(ck, image, side)
  if (!shrunk) return image
  const copy = ck.MakeImage(pixelInfo(ck, shrunk, isOpaque(ck, image)), shrunk.pixels, shrunk.width * 4)
  if (!copy) throw new Error('could not make a display copy')
  return copy
}

/**
 * The display copy of encoded image bytes, `side` long or the image's own size when that is
 * smaller, as pixels with the image's own size and whether it decodes opaque: what the image worker
 * makes. Null when they don't decode.
 */
export function madeCopy(ck: CanvasKit, bytes: Uint8Array, side: number): MadeCopy | null {
  const image = ck.MakeImageFromEncoded(bytes)
  if (!image) return null
  try {
    const own = { width: image.width(), height: image.height() }
    const opaque = isOpaque(ck, image)
    const shrunk = shrink(ck, image, side)
    if (shrunk) return { ...shrunk, own, opaque }
    const pixels = image.readPixels(0, 0, pixelInfo(ck, own, false))
    return pixels instanceof Uint8Array ? { ...own, pixels, own, opaque } : null
  } finally {
    image.delete()
  }
}

/** `image` shrunk to a long side of `side` with nearest mipmaps, as premultiplied pixels; null when it is no bigger. */
function shrink(ck: CanvasKit, image: Image, side: number) {
  const scale = side / Math.max(image.width(), image.height())
  if (scale >= 1) return null
  const width = Math.max(1, Math.round(image.width() * scale))
  const height = Math.max(1, Math.round(image.height() * scale))
  const surface = ck.MakeSurface(width, height)
  if (!surface) throw new Error(`could not make a ${width}×${height} surface for a display copy`)
  try {
    const canvas = surface.getCanvas()
    canvas.clear(ck.TRANSPARENT)
    canvas.drawImageRectOptions(
      image,
      ck.XYWHRect(0, 0, image.width(), image.height()),
      ck.XYWHRect(0, 0, width, height),
      ck.FilterMode.Linear,
      ck.MipmapMode.Nearest,
      null,
    )
    // Read out, so the copy holds its own pixels once the surface is freed.
    const pixels = canvas.readPixels(0, 0, pixelInfo(ck, { width, height }, false))
    if (!(pixels instanceof Uint8Array)) throw new Error('could not read a display copy')
    return { width, height, pixels }
  } finally {
    surface.dispose()
  }
}

/**
 * Premultiplied 8-bit sRGB pixels of a size, as display copies are held; marked opaque for an
 * image that decodes opaque, whose pixels are all opaque.
 */
function pixelInfo(ck: CanvasKit, { width, height }: ImageSize, opaque: boolean) {
  return {
    width,
    height,
    colorType: ck.ColorType.RGBA_8888,
    alphaType: opaque ? ck.AlphaType.Opaque : ck.AlphaType.Premul,
    colorSpace: ck.ColorSpace.SRGB,
  }
}

/** What a copy `side` long of an image of this own size costs held, as `heldBytes` counts it. */
function copyBytes(own: ImageSize, side: number): number {
  const scale = Math.min(1, side / Math.max(own.width, own.height))
  return pixelBytes(Math.max(1, Math.round(own.width * scale)), Math.max(1, Math.round(own.height * scale)))
}

/** The bytes of an image this size held: its pixels and its mipmapped texture. */
function pixelBytes(width: number, height: number): number {
  return (width * height * 4 * 7) / 3
}

/** Whether an image decoded with no alpha, as a JPEG does. */
function isOpaque(ck: CanvasKit, image: Image) {
  return image.getImageInfo().alphaType === ck.AlphaType.Opaque
}

/** Each scene's image uses, worked out once while the scene is the same object. */
const sceneUses = new WeakMap<Scene, Map<string, ImageUse[]>>()

function usesOf(scene: Scene): Map<string, ImageUse[]> {
  const known = sceneUses.get(scene)
  if (known) return known
  const uses = new Map<string, ImageUse[]>()
  const add = (value: unknown, box: ImageSize) => {
    for (const fill of imagePaints(value)) uses.set(fill.assetId, [...(uses.get(fill.assetId) ?? []), { fill, box }])
  }
  add(scene.fills, { width: scene.width, height: scene.height })
  const walk = (layers: readonly SceneLayer[]) => {
    for (const layer of layers) {
      const { width, height } = layer.props as { width?: number; height?: number }
      add(layer.props, { width: width ?? 0, height: height ?? 0 })
      walk(layer.children)
    }
  }
  walk(scene.layers)
  sceneUses.set(scene, uses)
  return uses
}

/** The image paints anywhere in a layer's props: its fills, its strokes' paints, a text's fills. */
function imagePaints(value: unknown, into: ImagePaint[] = []): ImagePaint[] {
  if (Array.isArray(value)) for (const item of value) imagePaints(item, into)
  else if (value && typeof value === 'object') {
    const paint = value as Partial<ImagePaint>
    if (paint.type === 'image' && typeof paint.assetId === 'string') into.push(paint as ImagePaint)
    else for (const item of Object.values(value)) imagePaints(item, into)
  }
  return into
}
