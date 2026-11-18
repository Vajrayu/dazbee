// A layer's icon by its kind and whether it is locked, as the layers panel shows them, which the
// stage's Select layer list shows too.
import { type Design, layoutOf, LOCK_FLAGS } from '@dazbee/schema'

import { boxLook, HOLDER_ICONS, type Words } from '@/components/editor/box-layouts.ts'
import {
  CircleIcon,
  type Icon,
  ImageIcon,
  PenNibIcon,
  SquareIcon,
  TextTIcon,
  UniteIcon,
} from '@/components/ui/icons.tsx'

type Layer = Design['nodes'][string]

export const isLocked = (node: Layer) => LOCK_FLAGS.some((flag) => node.lock?.[flag])

/** A layer's icon by its kind; a box's by its layout, as the layout section shows it. */
export function iconOf(node: Layer, words: Words): Icon {
  if (node.type === 'text') return TextTIcon
  if (node.type === 'group') return HOLDER_ICONS.group
  if (node.type === 'box') return boxLook(layoutOf(node.props), words).Icon
  if (node.type === 'boolean') return UniteIcon
  const props = node.props as { shape?: { kind?: string }; fills?: { type: string }[] }
  if (props.fills?.some((f) => f.type === 'image')) return ImageIcon
  if (props.shape?.kind === 'ellipse') return CircleIcon
  if (props.shape?.kind === 'path') return PenNibIcon
  return SquareIcon
}
