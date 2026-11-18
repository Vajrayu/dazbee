'use client'

// The corners of a rectangle or a box: one radius for all four, or each corner's own; and the one
// radius of a polygon or a star. The editor reads and sets them where each type keeps its radius.
import { type ReactNode } from 'react'

import { radiiAsDrawn } from '@dazbee/editor'

import { CornersOutIcon } from '@/components/ui/icons.tsx'

import { NumberField } from './number-field.tsx'
import { OneOrFour } from './one-or-four.tsx'
import { type P, shared, type Target } from './target.ts'

/** The corners as they are drawn, from the top left clockwise; the editor maps a flipped layer's to the ones it stores. */
const CORNERS = ['tl', 'tr', 'br', 'bl'] as const

/**
 * The order the fields sit in, two by two as the corners do: top left, top right, bottom left,
 * bottom right. They keep left to right in either direction, as the ad does.
 */
const CORNER_FIELDS = [0, 1, 3, 2] as const

/** Each selected layer's radii: one for all its corners, or each corner's own where it is drawn, a flipped layer's mirrored. */
function radiiIn(target: Target) {
  return target.props.map((props, i) => radiiAsDrawn(target.types[i] ?? '', props) ?? 0)
}

/**
 * The corners of a rectangle or a box: one radius for all, or with the button at the label's end a
 * radius for each, laid out where each corner is; the four show by themselves while the radii
 * differ. The editor reads and sets each radius where the layer's type keeps it. `label` names
 * them, Corners unless it is said.
 */
export function CornerFields({ target, p, label = p.cornerRadius }: { target: Target; p: P; label?: string }) {
  const all = radiiIn(target)
  return (
    <OneOrFour
      id="corner-fields"
      label={label}
      eachName={p.eachCorner}
      icon={<CornersOutIcon size={14} aria-hidden />}
      differ={all.some((r) => typeof r !== 'number' && shared([...r]) === 'mixed')}
      one={<RadiusField target={target} p={p} label={<CornersOutIcon size={14} aria-hidden />} />}
      four={CORNER_FIELDS.map((i) => (
        <NumberField
          key={CORNERS[i]}
          label={p.cornersShort[CORNERS[i]]}
          name={p.corners[CORNERS[i]]}
          value={shared(all.map((r) => (typeof r === 'number' ? r : r[i])))}
          min={0}
          editor={target.editor}
          onSet={(v) => target.editor.setRadius(target.ids, () => v, i)}
          onEach={(change) => target.editor.setRadius(target.ids, change, i)}
        />
      ))}
    />
  )
}

/**
 * The one radius of every selected layer's corners, mixed while they differ, with no top. `label`
 * stands before the number; `fillRange` is the range its fill shows the radius in.
 */
export function RadiusField({
  target,
  p,
  label,
  fillRange,
}: {
  target: Target
  p: P
  label: ReactNode
  fillRange?: readonly [number, number]
}) {
  const ones = radiiIn(target).map((r) => (typeof r === 'number' ? r : shared([...r])))
  return (
    <NumberField
      label={label}
      name={p.cornerRadius}
      value={ones.includes('mixed') ? 'mixed' : shared(ones)}
      min={0}
      {...(fillRange ? { fillRange } : {})}
      editor={target.editor}
      onSet={(n) => target.editor.setRadius(target.ids, () => n)}
      onEach={(change) => target.editor.setRadius(target.ids, change)}
    />
  )
}
