// Picking a colour from the design. While picking, a press on the stage selects nothing
// and starts no drag, and its release picks the colour of the design pixel under it as the 1x
// export draws it: the frame there is drawn whole at 1x by the sampler (the export worker in a
// browser, here without one) and its pixels are held while picking. One pick ends picking; Esc,
// `stop` and a second start end it with none. It writes nothing: the page sets the colour picked.
import type { Session } from '@dazbee/doc'
import type { ResourceBytes } from '@dazbee/renderer'
import { type Design, exportFits, type Point } from '@dazbee/schema'

import type { EditorView } from '../canvas/view.ts'
import type { NoticeDetail } from '../core-interface.ts'
import { listenerSet } from '../listener-set.ts'
import type { EditorResources } from '../resources.ts'
import type { PointerInput } from './inputs.ts'
import type { EditorPan } from './pan.ts'

/** A frame drawn whole at 1x: its unpremultiplied RGBA pixels, row by row, as the 1x export holds them. */
export interface SampledFrame {
  width: number
  height: number
  pixels: Uint8Array
}

/** What draws the frames picking a colour reads: the export worker's client, or the core itself without one. */
export interface FrameSampler {
  /**
   * Draws a frame of a design whole at 1x, as the 1x export draws it, with these fonts and images.
   * Gives null when a later ask took its place before it was drawn, or it was let go of, or the
   * frame is gone; rejects when what draws it failed.
   */
  sample(design: Design, frameId: string, bytes: ResourceBytes): Promise<SampledFrame | null>
  /** Lets go of a frame asked for and not yet drawing, whose ask gives null. */
  cancel(): void
}

/** The design pixels around the hot spot, which the loupe shows. */
export interface PickWindow {
  frameId: string
  /** The design pixel under the hot spot, in its frame. */
  x: number
  y: number
  /** The frame's size, in design pixels: a cell past it is off the frame. */
  width: number
  height: number
  /** How many design pixels the window has a side: odd, the hot spot's in the middle. */
  size: number
  /** `size` × `size` unpremultiplied RGBA cells, row by row; a cell off the frame is clear. */
  pixels: Uint8Array
}

/**
 * What picking shows, at the hot spot: the colour there (`colour`, with its hex), a pixel too clear
 * to pick (`clear`), a frame still drawing with no pixels of it held (`drawing`), one too big to
 * draw (`tooBig`), or no frame (`outside`). The window is of the frame's pixels as last drawn,
 * which show while it draws again.
 */
export interface PickShown {
  /** The hot spot, as a stage point, and the pointer it follows. */
  at: Point
  pointerType: string
  state: 'colour' | 'clear' | 'drawing' | 'tooBig' | 'outside'
  /** `#RRGGBB`, with `colour`; null otherwise. */
  hex: string | null
  window: PickWindow | null
}

export interface ColourPickDeps {
  session: Pick<Session, 'design' | 'changes'>
  /** Calls back when the design changes; gives what stops it. */
  onDesignChange: (listener: () => void) => () => void
  view: Pick<EditorView, 'camera' | 'pointOn'>
  /** The fonts, images and brand kit's values a frame is drawn with, which `onBytes` tells a change of. */
  resources: Pick<EditorResources, 'bytes' | 'load' | 'loaded' | 'onBytes'>
  /** The frame picking first draws when it starts off every frame: the selection's, or the picked frame. */
  frameInUse: () => string | null
  sampler: FrameSampler
  /** Whether the tab may only view the design, whose start is refused, and the page told View only. */
  readOnly: () => boolean
  tellViewOnly: () => void
  notify: (...told: NoticeDetail<'pickFailed' | 'pickTooBig'>) => void
  /** Runs a callback after a time, and gives what cancels it; without it a click waits on its draw for as long as it takes. */
  after?: ((ms: number, run: () => void) => () => void) | undefined
  /** Aborted when the editor ends, which ends picking. */
  signal: AbortSignal
  /** Tells that what is shown changed. */
  shownChanged: () => void
}

export interface EditorColourPick {
  /**
   * Starts picking, ending any picking on: `at`, the pointer's place on the stage when it is there.
   * Resolves with the colour picked as `#RRGGBB`, or null when picking ends with none.
   */
  start(at: Point | null): Promise<string | null>
  /** Ends picking with no colour picked. Returns whether it was picking. */
  stop(): boolean
  picking(): boolean
  /** Calls back with whether it is picking, each time it starts and ends. */
  onPicking(listener: (picking: boolean) => void): () => boolean
  /**
   * Takes a pointer input while picking, and the rest of a press made while picking after it ends;
   * leaves the wheel and the presses and moves of a pan (`pan`) to the pointer. Returns whether it
   * took the input.
   */
  route(e: PointerInput, pan: Pick<EditorPan, 'ready' | 'held'>): boolean
  /** What picking shows at the hot spot; null while not picking or with the pointer off the stage. */
  shown(): PickShown | null
}

/** How long a click waits for its frame to be drawn before it picks nothing. */
export const PICK_WAIT_MS = 10_000
/** A pixel with less alpha is too clear to pick: its unpremultiplied colour is coarse. */
export const ALPHA_CUT = 6
/** The pixels held at most, in bytes: two frames only while both fit. */
export const HOLD_BYTES = 32 * 1024 * 1024
/** The loupe's width, in CSS pixels, which the window's cells fill. */
export const LOUPE_SIDE = 110
/** A cell's least width, in CSS pixels, so the loupe never magnifies less than the canvas. */
const LEAST_CELL = 10

/**
 * What a frame is drawn from: the design as it was after so many changes (the design itself is
 * live), and the bytes it is drawn with, a new object whenever fonts, images or the brand kit's
 * values change.
 */
interface DrawnFrom {
  changes: number
  bytes: ResourceBytes
}

/** A frame's pixels as held, with what they were drawn from. */
interface Held extends SampledFrame, DrawnFrom {
  frameId: string
}

/** A frame asked to be drawn, by its number, and what it was asked to be drawn from. */
interface Ask extends DrawnFrom {
  n: number
  frameId: string
}

export function editorColourPick({
  session,
  onDesignChange,
  view,
  resources,
  frameInUse,
  sampler,
  readOnly,
  tellViewOnly,
  notify,
  after,
  signal,
  shownChanged,
}: ColourPickDeps): EditorColourPick {
  /** Settles the picking under way with what it picked; null while not picking. */
  let settle: ((hex: string | null) => void) | null = null
  /** Counts the pickings started, so a draw for an earlier one is dropped. */
  let run = 0
  /** The hot spot, as a stage point, with the pointer it follows; null off the stage. */
  let hot: { at: Point; pointerType: string } | null = null
  /** The press made while picking, until its pointers lift: `cancelled` once a pick can't come of it. */
  let press: { pointerType: string; cancelled: boolean; fingers: number } | null = null
  /** Whether the click and the capture a press made while picking ends with are still to come. */
  let tail = false
  /** The frames' pixels held, the latest drawn first. */
  let held: Held[] = []
  /** The latest frame asked to be drawn, and how many asks there have been. */
  let asked: Ask | null = null
  let asks = 0
  /** A click waiting for its frame to be drawn: the pixel it picks, the first ask it may pick from, and its time limit. */
  let waiting: { frameId: string; x: number; y: number; from: number; cancel: (() => void) | undefined } | null = null
  /** Stops hearing the changes of the design and of the bytes. */
  let stopChanges: (() => void)[] = []
  const pickings = listenerSet<[picking: boolean]>()

  const picking = () => settle !== null
  /** The frame under the hot spot, as last drawn. */
  const hotFrame = () => (hot ? view.pointOn(hot.at) : null)
  /** A frame as the design holds it now, which can be ahead of the last redraw: gone, or another size. */
  function stored(frameId: string | undefined) {
    const { frames } = session.design()
    return frameId !== undefined && Object.hasOwn(frames, frameId) ? frames[frameId] : undefined
  }
  /** What a frame is drawn from now; null while a change to the design is still being written. */
  function now(): DrawnFrom | null {
    const changes = session.changes()
    return changes === null ? null : { changes, bytes: resources.bytes() }
  }
  const same = (a: DrawnFrom, b: DrawnFrom | null) => a.changes === b?.changes && a.bytes === b.bytes
  /** A frame's pixels held, when they are of the design as it is. */
  function fresh(frameId: string) {
    const from = now()
    return held.find((h) => h.frameId === frameId && same(h, from))
  }

  function shown(): PickShown | null {
    if (!picking() || !hot) return null
    const on = hotFrame()
    const frame = stored(on?.frame.id)
    const base = { at: hot.at, pointerType: hot.pointerType, hex: null, window: null }
    if (!on || !frame) return { ...base, state: 'outside' }
    if (!exportFits(frame, 1)) return { ...base, state: 'tooBig' }
    const last = held.find((h) => h.frameId === on.frame.id)
    if (!last) return { ...base, state: 'drawing' }
    const x = Math.floor(on.p.x)
    const y = Math.floor(on.p.y)
    const hex = hexAt(last, x, y)
    return {
      ...base,
      state: hex ? 'colour' : 'clear',
      hex,
      window: windowOf(last, x, y, windowSide(view.camera().zoom)),
    }
  }

  function start(at: Point | null): Promise<string | null> {
    if (readOnly()) {
      tellViewOnly()
      return Promise.resolve(null)
    }
    end(null)
    const picked = new Promise<string | null>((resolve) => {
      settle = resolve
    })
    run += 1
    hot = at && { at, pointerType: 'mouse' }
    stopChanges = [onDesignChange(wantAgain), resources.onBytes(wantAgain)]
    want(hotFrame()?.frame.id ?? frameInUse() ?? undefined)
    pickings.emit(true)
    shownChanged()
    return picked
  }
  /**
   * The design or the bytes changed: the frame under the hot spot, else the one last asked for, is
   * asked for again, once the change is told to all, when the design is read.
   */
  function wantAgain() {
    void Promise.resolve().then(() => {
      if (picking()) want(hotFrame()?.frame.id ?? asked?.frameId)
    })
  }
  function stop() {
    if (!picking()) return false
    end(null)
    return true
  }
  /** Ends picking with what it picked, freeing all it held. */
  function end(hex: string | null) {
    const done = settle
    if (!done) return
    settle = null
    run += 1
    held = []
    asked = null
    sampler.cancel()
    waiting?.cancel?.()
    waiting = null
    press = null
    hot = null
    for (const stopping of stopChanges) stopping()
    stopChanges = []
    done(hex)
    if (signal.aborted) return
    pickings.emit(false)
    shownChanged()
  }

  /**
   * Asks for a frame to be drawn, unless the design holds no such frame now, it is too big to draw,
   * its pixels held are of the design as it is, or it is asked for already; while a click waits on
   * its frame, no other is asked for.
   */
  function want(frameId: string | undefined) {
    const frame = stored(frameId)
    if (!frameId || !frame || !exportFits(frame, 1) || (waiting && waiting.frameId !== frameId)) return
    const from = now()
    if (fresh(frameId) || !from || (asked?.frameId === frameId && same(asked, from))) return
    asks += 1
    asked = { n: asks, frameId, ...from }
    void draw(asked)
  }
  /** Draws a frame once its fonts and images are here, as an export does, and holds its pixels. */
  async function draw(ask: Ask) {
    const of = run
    try {
      resources.load(session.design(), [ask.frameId])
      await resources.loaded()
      // A later ask, or the end of picking, came meanwhile: a change since this ask asked again. A
      // frame deleted or grown too big meanwhile is not drawn.
      const frame = stored(ask.frameId)
      if (of !== run || ask.n !== asks || !frame || !exportFits(frame, 1)) return
      const bytes = resources.bytes()
      const sample = await sampler.sample(session.design(), ask.frameId, bytes)
      if (!sample || of !== run) return
      hold({ ...sample, frameId: ask.frameId, changes: ask.changes, bytes })
      shownChanged()
      if (waiting?.frameId === ask.frameId && ask.n >= waiting.from) pickWaiting()
    } catch {
      if (of !== run) return
      notify('pickFailed')
      end(null)
    }
  }
  /**
   * Holds a frame's pixels beside one other only while both fit HOLD_BYTES: the frame under the hot
   * spot is never let go of for a late draw of another, and is kept first; else the latest drawn.
   */
  function hold(next: Held) {
    const all = [next, ...held.filter((h) => h.frameId !== next.frameId)]
    const under = hotFrame()?.frame.id
    const first = all.find((h) => h.frameId === under) ?? next
    const second = all.find((h) => h !== first)
    held = second && first.pixels.length + second.pixels.length <= HOLD_BYTES ? [first, second] : [first]
  }

  /**
   * A click at a stage point: picks the pixel there from the frame's pixels when they are of the
   * design as it is, else from the first draw asked at or after the click, within PICK_WAIT_MS.
   * Off every frame, on a frame too big to draw and on a pixel too clear, it picks nothing and
   * picking stays on.
   */
  function pickAt(at: Point) {
    const on = view.pointOn(at)
    const frame = stored(on?.frame.id)
    if (!on || !frame) return
    if (!exportFits(frame, 1)) {
      notify('pickTooBig')
      return
    }
    const x = Math.floor(on.p.x)
    const y = Math.floor(on.p.y)
    const drawn = fresh(on.frame.id)
    if (drawn) {
      pickFrom(drawn, x, y)
      return
    }
    waiting?.cancel?.()
    waiting = null
    want(on.frame.id)
    const from = asked?.frameId === on.frame.id ? asked.n : asks + 1
    waiting = { frameId: on.frame.id, x, y, from, cancel: after?.(PICK_WAIT_MS, timedOut) }
  }
  function pickWaiting() {
    const click = waiting
    const drawn = click && held.find((h) => h.frameId === click.frameId)
    waiting = null
    click?.cancel?.()
    if (click && drawn) pickFrom(drawn, click.x, click.y)
  }
  function pickFrom(drawn: Held, x: number, y: number) {
    const hex = hexAt(drawn, x, y)
    if (hex) end(hex)
  }
  /** A click's frame took too long to draw: nothing is picked, and the page is told. */
  function timedOut() {
    if (!waiting) return
    waiting = null
    notify('pickFailed')
    end(null)
  }

  function route(e: PointerInput, pan: Pick<EditorPan, 'ready' | 'held'>): boolean {
    if (e.type === 'pointerdown' && !picking()) tail = false
    if ((!picking() && !tail) || e.type === 'wheel' || pan.held()) return false
    // The release of a press made before picking started is the pointer's.
    const ending = e.type === 'pointerup' || e.type === 'pointercancel' || e.type === 'lostpointercapture'
    if (ending && !press) return false
    if (e.type === 'pointerdown') {
      if (e.button === 1 || (e.button === 0 && pan.ready())) return false
      down(e)
    } else if (e.type === 'pointermove') {
      follow(e)
    } else if (e.type === 'pointerup') {
      up(e)
    } else if (e.type === 'pointercancel') {
      lift(true)
    } else if (e.type === 'click') {
      tail = false
    } else if (e.type === 'pointerleave') {
      hot = null
      shownChanged()
      return false
    }
    return true
  }
  /** A press: a second finger, or a button other than the main one, picks nothing. */
  function down(e: PointerInput) {
    tail = true
    if (!picking()) return
    if (press && e.pointerType === 'touch' && press.pointerType === 'touch') {
      press.cancelled = true
      press.fingers += 1
      return
    }
    press = { pointerType: e.pointerType, cancelled: e.button !== 0, fingers: 1 }
    follow(e)
  }
  function follow(e: PointerInput) {
    if (!picking()) return
    hot = { at: e.at, pointerType: e.pointerType }
    want(hotFrame()?.frame.id)
    shownChanged()
  }
  /** A release picks where it is, unless the press can't pick. */
  function up(e: PointerInput) {
    const picks = picking() && press && !press.cancelled
    lift(false)
    if (picks) pickAt(e.at)
  }
  /** One of the press's pointers lifts: once none is left, the press has ended; a cancelled one picks nothing. */
  function lift(cancelled: boolean) {
    if (!press) return
    if (cancelled) press.cancelled = true
    press.fingers -= 1
    if (press.fingers <= 0) press = null
    else press.cancelled = true
  }

  signal.addEventListener('abort', () => end(null))

  return {
    start,
    stop,
    picking,
    onPicking: pickings.on,
    route,
    shown,
  }
}

/** A cell's width in the loupe, in CSS pixels, at a zoom: LEAST_CELL, or the zoom's own past it. */
export function cellSide(zoom: number): number {
  return Math.max(LEAST_CELL, zoom)
}

/** The window's side, in design pixels, at a zoom: the odd count of cells of `cellSide` that fits the loupe, 3 at least. */
export function windowSide(zoom: number): number {
  const fits = Math.floor(LOUPE_SIDE / cellSide(zoom))
  return Math.max(3, fits % 2 === 1 ? fits : fits - 1)
}

/** The pixel of a frame drawn, as `#RRGGBB`; null off it or under ALPHA_CUT. */
function hexAt(drawn: SampledFrame, x: number, y: number): string | null {
  if (x < 0 || y < 0 || x >= drawn.width || y >= drawn.height) return null
  const i = (y * drawn.width + x) * 4
  if ((drawn.pixels[i + 3] ?? 0) < ALPHA_CUT) return null
  const hex = [0, 1, 2].map((c) => (drawn.pixels[i + c] ?? 0).toString(16).padStart(2, '0')).join('')
  return `#${hex.toUpperCase()}`
}

/** The `side` × `side` window of a frame drawn, centred on a pixel. */
function windowOf(drawn: Held, x: number, y: number, side: number): PickWindow {
  const pixels = new Uint8Array(side * side * 4)
  const half = (side - 1) / 2
  for (let row = 0; row < side; row++) {
    const py = y - half + row
    if (py < 0 || py >= drawn.height) continue
    for (let column = 0; column < side; column++) {
      const px = x - half + column
      if (px < 0 || px >= drawn.width) continue
      const from = (py * drawn.width + px) * 4
      pixels.set(drawn.pixels.subarray(from, from + 4), (row * side + column) * 4)
    }
  }
  return { frameId: drawn.frameId, x, y, width: drawn.width, height: drawn.height, size: side, pixels }
}
