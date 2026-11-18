// The canvas gesture matrix: every canvas gesture against every kind of container, in one
// frame of a design that has two linked frames and a third linked to neither, with pointer and
// keyboard input sent through a driver (driver.ts). Each gesture is checked against what it should
// do: a move moves the layer by the drag, a resize sizes it from the handle dragged (scaling a
// group's or boolean's layers, never a box's, whose layers keep to its left and top) and a path's drawing with its box, and fixes the
// sizing of the axes it drags while the other keeps its own, a turn turns it, align lines it up,
// the other frame and the third stay as they were, auto layout keeps placing its flow (a drag or
// an arrow moves a layer along it, and what it decides is said), a drag onto the third frame moves
// the layer there, or with Alt a copy of it, kept where it was dropped, unless it can't leave its
// frame, the gesture is one undo step, and nothing logs an error. Failures that have a ticket of their own are listed in KNOWN
// (run-matrix.ts).
import { frameIdOf, type Point, type Rect } from '@dazbee/schema'

import { type Handle, HANDLES as RESIZE_HANDLES } from '../layers/transform.ts'
import type { ShortcutAction } from '../shortcuts.ts'
import { copyIn, type Design as Doc, layersIn } from './design-builders.ts'
import type { MatrixDriver } from './driver.ts'
import { BESIDE, FLOW, HOLDS, LEAVES, PATH_INK, type Subject, UNLINKED } from './matrix-design.ts'

/** The matrix's two linked frames: the square and the wide one. */
export const FRAME_IDS = ['sq', 'wide'] as const
/** One of the matrix's frames. */
export type FrameId = (typeof FRAME_IDS)[number]
/** One row of the matrix: a gesture on a subject in a frame. */
export interface Row {
  subject: Subject
  gesture: string
  frameId: FrameId
}

type Boxes = Record<string, Rect | null>
const HANDLES: Record<string, { dx: number; dy: number; w: number; h: number }> = {
  e: { dx: 40, dy: 0, w: 40, h: 0 },
  w: { dx: -40, dy: 0, w: 40, h: 0 },
  s: { dx: 0, dy: 30, w: 0, h: 30 },
  n: { dx: 0, dy: -30, w: 0, h: 30 },
  se: { dx: 40, dy: 30, w: 40, h: 30 },
  nw: { dx: -40, dy: -30, w: 40, h: 30 },
  ne: { dx: 40, dy: -30, w: 40, h: 30 },
  sw: { dx: -40, dy: 30, w: 40, h: 30 },
}
export const GESTURES = [
  'move',
  ...Object.keys(HANDLES).map((h) => `resize-${h}`),
  'rotate',
  'nudge',
  'align',
  'distribute',
  'duplicate',
  'paste',
  'group',
  'box-selection',
  'ungroup',
  'delete',
  'move-across',
  'copy-across',
] as const
/** Where the drags onto the frame linked to neither take the pointer, in that frame: clear of its layer. */
const ACROSS = { x: 350, y: 350 }
/** The subjects that can't leave their frame, which a drag onto another moves in it (into-frame.ts). */
const STAYS = new Set(['gA', 'mask', 'masked'])
/** A layer of the matrix in a frame: itself in the square, its linked copy in the wide frame. */
export const idIn = (frameId: FrameId, id: string) => (frameId === 'sq' ? id : copyIn(frameId, id))

const WIDTH: Record<FrameId, number> = { sq: 1080, wide: 1920 }
const AUTO = new Set(['auto', 'aHug', 'col', 'autoTurned'])
const TEXT = new Set(['tWide', 'tTall', 'tFixed'])
/** Layers turned on the page as drawn, by degrees: a handle dragged along the page sizes them by the part along their side. */
const TURNED: Record<string, number> = { turned: 20, tInner: 20, autoTurned: 10, atA: 10 }
const ALL = [...LEAVES, ...Object.keys(HOLDS)]

/** Whether a name is a handle a selection is resized from. */
const isHandle = (name: string): name is Handle => RESIZE_HANDLES.some((handle) => handle === name)
/** The matrix's layer a layer of a frame is, or the id itself for a layer the matrix didn't make. */
const subjectOf = (frameId: FrameId, id: string) =>
  frameId === 'sq' || !id.startsWith(`${frameId}-`) ? id : id.slice(frameId.length + 1)

/** The boxes of the matrix's layers in a frame, by the layer of the square each is or copies. */
const boxesIn = async (driver: MatrixDriver, frameId: FrameId): Promise<Boxes> => {
  const boxes = await driver.boxesOf(ALL.map((id) => idIn(frameId, id)))
  return Object.fromEntries(ALL.map((id, i) => [id, boxes[i] ?? null]))
}
/** The layers a frame holds as the design stores them, as JSON, so a frame left as it was compares equal. */
const storedIn = (doc: Doc, frameId: string) =>
  JSON.stringify(layersIn(doc, frameId).sort(([a], [b]) => (a < b ? -1 : 1)))
/** Where a colour is drawn in a frame's export: the box around its pixels, in design pixels, or null. */
const inkOf = async (driver: MatrixDriver, frameId: FrameId, rgb: [number, number, number]): Promise<Rect | null> => {
  const pixels = await driver.exportPixels(frameId)
  const width = WIDTH[frameId]
  if (!pixels) return null
  let [left, top, right, bottom] = [Infinity, Infinity, -Infinity, -Infinity]
  for (let i = 0; i < pixels.length; i += 4) {
    if (
      Math.abs((pixels[i] ?? 0) - rgb[0]) > 8 ||
      Math.abs((pixels[i + 1] ?? 0) - rgb[1]) > 8 ||
      Math.abs((pixels[i + 2] ?? 0) - rgb[2]) > 8
    )
      continue
    const x = (i / 4) % width
    const y = Math.floor(i / 4 / width)
    left = Math.min(left, x)
    top = Math.min(top, y)
    right = Math.max(right, x + 1)
    bottom = Math.max(bottom, y + 1)
  }
  return left === Infinity ? null : { x: left, y: top, width: right - left, height: bottom - top }
}
const close = (a: number, b: number, tol = 0.6) => Math.abs(a - b) <= tol
const same = (a: Rect | null | undefined, b: Rect | null | undefined) =>
  !a || !b || (close(a.x, b.x) && close(a.y, b.y) && close(a.width, b.width) && close(a.height, b.height))
const flowOrder = (doc: Doc, frameId: FrameId, parent: string) =>
  Object.entries(doc.nodes)
    .filter(([id, n]) => n.parentId === idIn(frameId, parent) && FLOW[subjectOf(frameId, id)])
    .sort(([, a], [, b]) => (a.index < b.index ? -1 : 1))
    .map(([id]) => id)
    .join()

/**
 * Runs one row on a driver that has the matrix's design open and its frame in view: selects the
 * subject, runs the gesture and checks what it did, then undoes it. Returns 'n/a', null when it did
 * what it should, or what went wrong, with the errors it raised.
 */
export async function runRow(driver: MatrixDriver, { subject, gesture, frameId }: Row): Promise<string | null> {
  const other = frameId === 'sq' ? 'wide' : 'sq'
  await driver.select([idIn(frameId, subject)])
  await driver.drawn()
  await driver.takeErrors()
  const problem = await run(driver, subject, gesture, frameId, other)
  const errors = await driver.takeErrors()
  const logged = errors.length > 0 ? `errors: ${errors.join(' | ')}` : null
  if (problem === 'n/a') return 'n/a'
  return [problem, logged].filter(Boolean).join('; ') || null
}

/** Runs one gesture on the subject; returns what went wrong, null when it did what it should, or 'n/a'. */
async function run(
  driver: MatrixDriver,
  subject: Subject,
  gesture: string,
  frameId: FrameId,
  other: FrameId,
): Promise<string | null> {
  const before = await boxesIn(driver, frameId)
  const beforeOther = await boxesIn(driver, other)
  const [beforeApart] = await driver.boxesOf([UNLINKED.layer])
  const json = await driver.design()
  const doc = JSON.parse(json) as Doc
  const self = idIn(frameId, subject)
  const count = Object.keys(doc.nodes).length
  const noticesBefore = await driver.notices()
  const box = before[subject]
  if (!box) return 'no box before'
  const zoom = await driver.zoom()
  // A group's middle may be a gap between its layers: it is pressed on its first one.
  const grip =
    subject === 'group' || subject === 'bool' || subject === 'paths' ? (before[HOLDS[subject]?.[0] ?? ''] ?? box) : box
  const centre = await driver.stagePoint(grip.x + grip.width / 2, grip.y + grip.height / 2, frameId)
  const turnBy = ((TURNED[subject] ?? 0) * Math.PI) / 180
  const flowParent = FLOW[subject]
  /** Where a drag onto the frame linked to neither let the pointer go. */
  let dropped: Point | null = null
  switch (true) {
    case gesture === 'move': {
      // In a flow, a drag to its other end; anywhere else, by 30, 20.
      const flow = flowParent ? (HOLDS[flowParent] ?? []).filter((id) => FLOW[id]) : []
      const isLast = flow.at(-1) === subject
      const end = flow
        .filter((id) => id !== subject)
        .map((id) => before[id])
        .filter((b): b is Rect => b !== null)
        .at(isLast ? 0 : -1)
      // Past that sibling's far corner, so a row or a column takes it beyond it.
      const to = end
        ? await driver.stagePoint(
            isLast ? end.x + 2 : end.x + end.width - 2,
            isLast ? end.y + 2 : end.y + end.height - 2,
            frameId,
          )
        : { x: centre.x + 30 * zoom, y: centre.y + 20 * zoom }
      await drag(driver, centre, to)
      break
    }
    case gesture.startsWith('resize-'): {
      const which = gesture.slice(7)
      const h = HANDLES[which]
      const at = isHandle(which) ? await driver.handleAt(which) : null
      // Text that grows with its words has no top or bottom handles: only a fixed box has a height of its own.
      if (TEXT.has(subject) && subject !== 'tFixed' && (which === 'n' || which === 's'))
        return at ? `has an ${which} handle` : 'n/a'
      if (!h || !at) return `no ${which} handle`
      await drag(driver, at, { x: at.x + h.dx * zoom, y: at.y + h.dy * zoom })
      break
    }
    case gesture === 'rotate': {
      const at = await driver.handleAt('ne')
      if (!at) return 'no ne handle'
      await drag(driver, { x: at.x + 12, y: at.y - 12 }, { x: at.x + 40, y: at.y + 30 })
      break
    }
    case gesture === 'nudge':
      await press(driver, 'nudgeRight')
      break
    case gesture === 'align':
      await press(driver, 'alignLeft')
      break
    case gesture === 'distribute': {
      const beside = BESIDE[subject]
      if (!beside) return 'n/a'
      await driver.select([subject, ...beside].map((id) => idIn(frameId, id)))
      await press(driver, 'distributeHorizontal')
      break
    }
    case gesture === 'duplicate':
      await press(driver, 'duplicate')
      break
    case gesture === 'paste':
      await driver.copy()
      await driver.paste()
      await driver.drawn()
      break
    case gesture === 'group':
      await press(driver, 'group')
      break
    case gesture === 'box-selection':
      await press(driver, 'boxSelection')
      break
    case gesture === 'ungroup':
      await press(driver, 'ungroup')
      break
    case gesture === 'delete':
      await press(driver, 'delete')
      break
    case gesture === 'move-across' || gesture === 'copy-across': {
      dropped = await driver.stagePoint(ACROSS.x, ACROSS.y, UNLINKED.frameId)
      const copy = gesture === 'copy-across'
      if (copy) await driver.alt(true)
      await drag(driver, centre, dropped)
      if (copy) await driver.alt(false)
      break
    }
  }
  const after = await boxesIn(driver, frameId)
  const afterOther = await boxesIn(driver, other)
  const [afterApart] = await driver.boxesOf([UNLINKED.layer])
  const now = JSON.parse(await driver.design()) as Doc
  // What a drag onto the frame linked to neither added to it: the layer and what it holds, or a copy
  // of them. No other gesture may add to it.
  const added = dropped
    ? Object.keys(now.nodes).filter(
        (id) => frameIdOf(now, id) === UNLINKED.frameId && frameIdOf(doc, id) !== UNLINKED.frameId,
      )
    : []
  const told = (await driver.notices()) > noticesBefore
  const problems: string[] = []
  const b = after[subject]
  // Who may change: the subject and what it holds, what holds it, and a flow it is in.
  const inside = (id: string): string[] => (HOLDS[id] ?? []).flatMap((kid) => [kid, ...inside(kid)])
  const holders = Object.entries(HOLDS)
    .filter(([, kids]) => kids.includes(subject))
    .map(([id]) => id)
  const flowMates = flowParent ? [...inside(flowParent), flowParent] : AUTO.has(subject) ? inside(subject) : []
  const may = new Set([
    subject,
    ...inside(subject),
    ...holders,
    ...flowMates,
    ...(gesture === 'distribute' ? [...(BESIDE[subject] ?? []), ...(BESIDE[subject] ?? []).flatMap(inside)] : []),
  ])
  const placement =
    gesture === 'move' ||
    dropped !== null ||
    gesture.startsWith('resize-') ||
    ['rotate', 'nudge', 'align', 'distribute'].includes(gesture)
  if (placement) for (const id of ALL) if (!may.has(id) && !same(before[id], after[id])) problems.push(`${id} changed`)
  // Every gesture stays in its frame: the other frame's layers are drawn and stored as they were.
  for (const id of ALL) if (!same(beforeOther[id], afterOther[id])) problems.push(`${id} changed in ${other}`)
  if (storedIn(now, other) !== storedIn(doc, other)) problems.push(`${other} stored differently`)
  // And the frame linked to neither: itself, and its layer drawn and stored, as they were.
  if (!beforeApart || !afterApart || !same(beforeApart, afterApart))
    problems.push(`${UNLINKED.layer} drawn at ${JSON.stringify(afterApart)}, not ${JSON.stringify(beforeApart)}`)
  if (storedIn(without(now, new Set(added)), UNLINKED.frameId) !== storedIn(doc, UNLINKED.frameId))
    problems.push(`${UNLINKED.frameId} stored differently`)
  if (JSON.stringify(doc.frames[UNLINKED.frameId]) !== JSON.stringify(now.frames[UNLINKED.frameId]))
    problems.push(`${UNLINKED.frameId} itself changed`)
  if (gesture === 'move' && b) {
    if (flowParent) {
      if (flowOrder(doc, frameId, flowParent) === flowOrder(now, frameId, flowParent))
        problems.push('not moved along its flow')
    } else if (!close(b.x, box.x + 30, 1) || !close(b.y, box.y + 20, 1))
      problems.push(`moved to ${b.x},${b.y}, not by 30,20`)
  }
  if (gesture.startsWith('resize-') && b) {
    const which = gesture.slice(7)
    const h = HANDLES[which] as { dx: number; dy: number; w: number; h: number }
    // The drag along the layer's own sides, as it is turned.
    const sx = which.includes('e') ? 1 : which.includes('w') ? -1 : 0
    const wantW = box.width + sx * (h.dx * Math.cos(turnBy) + h.dy * Math.sin(turnBy))
    // A corner scales text: its box keeps its shape, by the factor of the side moved more, and its size with it.
    const corner = which.length === 2
    if (TEXT.has(subject) && corner) {
      const factor = Math.max((box.width + h.w) / box.width, (box.height + h.h) / box.height)
      const sizeOf = (d: Doc) => (d.nodes[self]?.props.style as { fontSize: number }).fontSize
      const want = Math.round(sizeOf(doc) * factor * 10) / 10
      if (!close(sizeOf(now), want, 0.15)) problems.push(`font size ${sizeOf(now)}, not ${want}`)
      // Auto width text takes the width its scaled words have; the others keep the box's shape.
      if (subject !== 'tWide' && !close(b.width, box.width * factor, box.width * factor * 0.04))
        problems.push(`width ${b.width}, not ${box.width * factor}`)
    } else if (h.w && !close(b.width, wantW, 1.5)) problems.push(`width ${b.width}, not ${wantW}`)
    if (h.h && !TEXT.has(subject) && !turnBy && !close(b.height, box.height + h.h, 1.5))
      problems.push(`height ${b.height}, not ${box.height + h.h}`)
    // A box's layers keep their size, set to left and top as each is; a group's or boolean's scale
    // with it; a flow fills what it is given.
    const scaled = subject === 'group' || subject === 'bool' || subject === 'paths'
    if (!scaled) {
      for (const id of inside(subject).filter((id) => id !== 'aFill'))
        if (
          before[id] &&
          after[id] &&
          (!close((before[id] as Rect).width, (after[id] as Rect).width) ||
            !close((before[id] as Rect).height, (after[id] as Rect).height))
        )
          problems.push(`${id} resized inside a box`)
      // Upright, each layer it holds that no flow places keeps its place from the box's left and top.
      for (const id of turnBy ? [] : (HOLDS[subject] ?? []).filter((id) => !FLOW[id])) {
        const [was, is] = [before[id], after[id]]
        if (was && is && (!close(is.x - b.x, was.x - box.x, 1) || !close(is.y - b.y, was.y - box.y, 1)))
          problems.push(
            `${id} at ${is.x - b.x},${is.y - b.y} from its box's left and top, not ${was.x - box.x},${was.y - box.y}`,
          )
      }
    }
    if (AUTO.has(subject)) {
      for (const id of inside(subject).filter((id) => FLOW[id])) {
        const kid = after[id]
        if (
          kid &&
          b &&
          !turnBy &&
          (kid.x < b.x - 0.5 ||
            kid.y < b.y - 0.5 ||
            kid.x + kid.width > b.x + b.width + 0.5 ||
            kid.y + kid.height > b.y + b.height + 0.5)
        )
          problems.push(`${id} outside its box`)
      }
    }
    // The axes dragged become fixed; the other keeps its sizing, so a hugging box made narrower
    // still hugs its height.
    const sizingOf = (d: Doc) => d.nodes[self]?.props.sizing as { width: string; height: string } | undefined
    const was = sizingOf(doc)
    if (was) {
      const want = { width: h.w ? 'fixed' : was.width, height: h.h ? 'fixed' : was.height }
      const is = sizingOf(now)
      if (is?.width !== want.width || is.height !== want.height)
        problems.push(`sizing ${JSON.stringify(is)}, not ${JSON.stringify(want)}`)
    }
    if (
      subject === 'photo' &&
      JSON.stringify(now.nodes[self]?.props.fills) !== JSON.stringify(doc.nodes[self]?.props.fills)
    )
      problems.push('crop changed')
    // A path draws to its new box, in the export too.
    for (const id of [subject, ...inside(subject)].filter((id) => PATH_INK[id])) {
      const ink = await inkOf(driver, frameId, PATH_INK[id] as [number, number, number])
      const want = after[id]
      if (
        want &&
        (!ink ||
          !close(ink.x, want.x, 2) ||
          !close(ink.y, want.y, 2) ||
          !close(ink.width, want.width, 2) ||
          !close(ink.height, want.height, 2))
      ) {
        problems.push(
          `${id} drawn at ${ink ? `${ink.x},${ink.y} ${ink.width}×${ink.height}` : 'nowhere'}, not its box ${want.x},${want.y} ${want.width}×${want.height}`,
        )
      }
    }
  }
  if (dropped)
    problems.push(
      ...(await acrossProblems(
        driver,
        { subject, gesture, frameId },
        { doc, now, added },
        { grip: centre, to: dropped, zoom, box },
      )),
    )
  if (gesture === 'rotate') {
    const turn = (d: Doc) => Number(d.nodes[self]?.props.rotation ?? 0)
    if (close(turn(doc), turn(now), 0.5)) problems.push('not turned')
  }
  if (gesture === 'nudge' && b) {
    if (flowParent) {
      if (flowOrder(doc, frameId, flowParent) === flowOrder(now, frameId, flowParent) && !told)
        problems.push('nothing moved and nothing said')
    } else if (!close(b.x, box.x + 1)) problems.push(`nudged to ${b.x}, not ${box.x + 1}`)
  }
  if (gesture === 'align' && b) {
    if (flowParent) {
      if (!told) problems.push('a flow layer, and nothing said')
    } else {
      const holder = holders[0] && before[holders[0]]
      const left = holder ? holder.x : 0
      if (!close(b.x, left, 1) && !turnBy && !holders.includes('turned')) problems.push(`left at ${b.x}, not ${left}`)
    }
  }
  if (gesture === 'distribute' && flowParent && !told) problems.push('a flow layer, and nothing said')
  if ((gesture === 'duplicate' || gesture === 'paste') && Object.keys(now.nodes).length <= count)
    problems.push('no copy')
  // A copy is drawn 20 right and down of its original, unless a flow places it.
  if (gesture === 'duplicate' && !flowParent) {
    const copy = Object.keys(now.nodes).find(
      (id) => !doc.nodes[id] && now.nodes[id]?.parentId === doc.nodes[self]?.parentId,
    )
    const [drawn] = copy ? await driver.boxesOf([copy]) : [null]
    const middle = (r: Rect) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 })
    if (!drawn || !close(middle(drawn).x, middle(box).x + 20, 1) || !close(middle(drawn).y, middle(box).y + 20, 1))
      problems.push(`copy drawn at ${drawn ? `${drawn.x},${drawn.y}` : 'nowhere'}, not 20,20 from ${box.x},${box.y}`)
  }
  if ((gesture === 'group' || gesture === 'box-selection') && Object.keys(now.nodes).length !== count + 1)
    problems.push('no new container')
  if (gesture === 'ungroup' && (subject === 'group' || subject === 'bool' || subject === 'paths') && now.nodes[self])
    problems.push('still there')
  if (gesture === 'delete' && now.nodes[self]) problems.push('not deleted')
  if (['group', 'box-selection', 'ungroup'].includes(gesture))
    for (const id of LEAVES) if (!same(before[id], after[id])) problems.push(`${id} moved`)
  // One undo step puts everything back.
  await press(driver, 'undo')
  if ((await driver.design()) !== json) {
    problems.push('one undo did not put it back')
    for (let i = 0; i < 5 && (await driver.design()) !== json; i++) {
      await press(driver, 'undo')
    }
  }
  return problems.length > 0 ? problems.join('; ') : null
}

/**
 * What went wrong with a drag of the subject onto the frame linked to neither, the pointer taken
 * from its middle (`grip`) to `to`, stage points at `zoom`. A subject that can leave its frame is
 * then in that frame, on its top, with what it holds, drawn on the page where the drag took it,
 * each layer keeping its link id, and selected; with Alt, a copy of it is, each layer with its
 * original's link id, the subject's frame stored as before. One that can't is in its parent, moved
 * by the drag, or with Alt a copy of it is, the subject where it was.
 */
async function acrossProblems(
  driver: MatrixDriver,
  { subject, gesture, frameId }: Row,
  { doc, now, added }: { doc: Doc; now: Doc; added: string[] },
  { grip, to, zoom, box }: { grip: Point; to: Point; zoom: number; box: Rect },
): Promise<string[]> {
  const problems: string[] = []
  const self = idIn(frameId, subject)
  const copy = gesture === 'copy-across'
  const made = Object.keys(now.nodes).filter((id) => !doc.nodes[id])
  const roots = made.filter((id) => !made.includes(now.nodes[id]?.parentId ?? ''))
  if (copy && roots.length !== 1) return [`made ${roots.length} top layers, not one copy`]
  const root = copy ? (roots[0] as string) : self
  if (!now.nodes[root]) return ['gone']
  if (JSON.stringify(await driver.selected()) !== JSON.stringify([root])) problems.push(`${root} not selected`)
  // Where the drag took it: its box before, plus the pointer's travel.
  const travel = { x: (to.x - grip.x) / zoom, y: (to.y - grip.y) / zoom }
  const [at] = await driver.boxesOf([root])
  if (STAYS.has(subject)) {
    if (added.length > 0) problems.push(`${added.join()} went into ${UNLINKED.frameId}`)
    if (now.nodes[root]?.parentId !== doc.nodes[self]?.parentId) problems.push(`in ${now.nodes[root]?.parentId}`)
    if (!at || !close(at.x, box.x + travel.x, 1) || !close(at.y, box.y + travel.y, 1))
      problems.push(`drawn at ${at ? `${at.x},${at.y}` : 'nowhere'}, not moved by the drag`)
    const [original] = await driver.boxesOf([self])
    if (copy && !same(original, box)) problems.push(`${self} moved`)
    return problems
  }
  const tops = Object.entries(now.nodes)
    .filter(([, n]) => n.parentId === UNLINKED.frameId)
    .sort(([, a], [, b]) => (a.index < b.index ? -1 : 1))
  if (now.nodes[root]?.parentId !== UNLINKED.frameId)
    problems.push(`in ${now.nodes[root]?.parentId}, not ${UNLINKED.frameId}`)
  else if (tops.at(-1)?.[0] !== root) problems.push(`not on top of ${UNLINKED.frameId}`)
  // Each layer of it, and the layer it copies: by order, as a copy holds what its original holds.
  const tree = (d: Doc, id: string): string[] => [
    id,
    ...Object.entries(d.nodes)
      .filter(([, n]) => n.parentId === id)
      .sort(([, a], [, b]) => (a.index < b.index ? -1 : 1))
      .flatMap(([kid]) => tree(d, kid)),
  ]
  const [was, is] = [tree(doc, self), tree(now, root)]
  if (was.length !== is.length) problems.push(`holds ${is.length - 1} layers, not ${was.length - 1}`)
  is.forEach((id, i) => {
    if (frameIdOf(now, id) !== UNLINKED.frameId) problems.push(`${id} in ${frameIdOf(now, id)}`)
    if (now.nodes[id]?.link !== doc.nodes[was[i] ?? '']?.link) problems.push(`${id} took a new link id`)
  })
  if (added.length !== is.length) problems.push(`${UNLINKED.frameId} gained ${added.length} layers, not ${is.length}`)
  // The copies were made beside their originals, which may give the layers around them new order
  // keys in the same order: the frame is stored as before, but for those keys.
  if (copy && orderedIn(now, frameId) !== orderedIn(doc, frameId)) problems.push(`${frameId} stored differently`)
  const page = (d: Doc, id: string) => d.frames[id] as { x: number; y: number }
  const want = {
    x: page(doc, frameId).x + box.x + travel.x - page(now, UNLINKED.frameId).x,
    y: page(doc, frameId).y + box.y + travel.y - page(now, UNLINKED.frameId).y,
  }
  if (!at || !close(at.x, want.x, 1) || !close(at.y, want.y, 1))
    problems.push(`drawn at ${at ? `${at.x},${at.y}` : 'nowhere'}, not ${want.x},${want.y}`)
  return problems
}
/** The layers a frame holds as stored, as JSON, each with its place among its siblings for its order key. */
function orderedIn(d: Doc, frameId: string) {
  const layers = layersIn(d, frameId)
  const placeOf = (parentId: string, index: string) =>
    layers.filter(([, n]) => n.parentId === parentId && n.index < index).length
  return JSON.stringify(
    layers
      .map(([id, n]) => [id, { ...n, index: placeOf(n.parentId, n.index) }] as const)
      .sort(([a], [b]) => (a < b ? -1 : 1)),
  )
}
/** A design without some of its layers. */
function without(d: Doc, ids: ReadonlySet<string>): Doc {
  return { ...d, nodes: Object.fromEntries(Object.entries(d.nodes).filter(([id]) => !ids.has(id))) }
}

async function drag(driver: MatrixDriver, a: { x: number; y: number }, b: { x: number; y: number }) {
  await driver.mouse.move(a)
  await driver.mouse.down()
  await driver.mouse.move({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, 3)
  await driver.mouse.move(b, 3)
  await driver.mouse.up()
  await driver.drawn()
}
/** Presses an action's shortcut and waits for the redraw, so the handles stand where the box now is. */
async function press(driver: MatrixDriver, action: ShortcutAction) {
  await driver.press(action)
  await driver.drawn()
}
