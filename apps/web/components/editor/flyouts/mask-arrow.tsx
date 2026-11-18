// The layers panel's mask arrows: for each shown mask that masks a layer, a thin line down the
// picture column of the mask's depth, from just below the topmost masked layer's picture to the
// mask's icon, ending in an arrowhead whose tip touches the icon. The line breaks behind the
// pictures of the rows of that depth it passes. Each is placed from row indexes and the rows'
// sizes, never from the page, so rows scrolled out of view don't break it; right to left, it runs
// down the mirrored column.
import type { MaskArrow, Row } from '@/lib/editor/layer-tree.ts'

import { MASK_ICON } from './mask-icon.tsx'
import { PICTURE, pictureMiddle, rowMiddle } from './tree-row.tsx'

/** The line's width, and the arrowhead's width and height, in pixels. */
const LINE = 1.25
const HEAD_WIDTH = 6
const HEAD = 5
/** The room the line leaves round a picture it passes. */
const CLEARANCE = 2

/** The arrows from masked layers to their masks, laid under the rows. */
export function MaskArrows({
  arrows,
  rows,
  pitch,
}: {
  arrows: readonly MaskArrow[]
  rows: readonly Row[]
  pitch: number
}) {
  return (
    <>
      {arrows.map((arrow) => (
        <MaskArrowLine key={`${arrow.from} ${arrow.to}`} arrow={arrow} rows={rows} pitch={pitch} />
      ))}
    </>
  )
}

/** One arrow, its top at the topmost masked row's picture and its tip at the mask's icon. */
function MaskArrowLine({ arrow, rows, pitch }: { arrow: MaskArrow; rows: readonly Row[]; pitch: number }) {
  const { from, to, depth } = arrow
  const middle = (i: number) => rowMiddle(i, pitch)
  const top = middle(from) + PICTURE / 2 + CLEARANCE
  const tip = middle(to) - MASK_ICON / 2
  // The stretches the line runs, broken behind the pictures of its depth between its ends.
  const lines: { top: number; bottom: number }[] = []
  let start = top
  for (let i = from + 1; i < to; i++) {
    if (rows[i]?.depth !== depth) continue
    lines.push({ top: start, bottom: middle(i) - PICTURE / 2 - CLEARANCE })
    start = middle(i) + PICTURE / 2 + CLEARANCE
  }
  lines.push({ top: start, bottom: tip - HEAD })
  return (
    <div
      aria-hidden
      data-testid="mask-arrow"
      data-mask={rows[to]?.id}
      data-from={from}
      className="pointer-events-none absolute text-muted"
      style={{ insetInlineStart: pictureMiddle(depth) - HEAD_WIDTH / 2, top, width: HEAD_WIDTH, height: tip - top }}
    >
      {lines.map((line) => (
        <span
          key={line.top}
          data-testid="mask-arrow-line"
          className="absolute bg-current"
          style={{
            insetInlineStart: (HEAD_WIDTH - LINE) / 2,
            width: LINE,
            top: line.top - top,
            height: Math.max(0, line.bottom - line.top),
          }}
        />
      ))}
      <svg
        data-testid="mask-arrow-head"
        width={HEAD_WIDTH}
        height={HEAD}
        viewBox={`0 0 ${HEAD_WIDTH} ${HEAD}`}
        className="absolute start-0 bottom-0"
      >
        <path d={`M0 0H${HEAD_WIDTH}L${HEAD_WIDTH / 2} ${HEAD}Z`} fill="currentColor" />
      </svg>
    </div>
  )
}
