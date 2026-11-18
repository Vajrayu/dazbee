'use client'

// The actions that arrange the selection, for the edit panel's Arrange and Shape tabs: align,
// distribute and combine. Several layers line up with each other; one layer lines up with its
// frame, or the group or box it is in. Two or more shapes combine into a live boolean.
import type { ShortcutAction } from '@dazbee/editor'

import {
  AlignBottomIcon,
  AlignCenterHorizontalIcon,
  AlignCenterVerticalIcon,
  AlignLeftIcon,
  AlignRightIcon,
  AlignTopIcon,
  ArrowsHorizontalIcon,
  ArrowsVerticalIcon,
  ExcludeSquareIcon,
  type Icon,
  IntersectSquareIcon,
  SubtractSquareIcon,
  UniteSquareIcon,
} from '@/components/ui/icons.tsx'

export type Action = Extract<
  ShortcutAction,
  | `align${string}`
  | `distribute${string}`
  | `boolean${string}`
  | 'group'
  | 'boxSelection'
  | 'ungroup'
  | 'duplicate'
  | 'mask'
  | 'bringToFront'
  | 'bringForward'
  | 'sendBackward'
  | 'sendToBack'
>
export const ALIGN: { action: Extract<Action, `align${string}`>; icon: Icon }[] = [
  { action: 'alignLeft', icon: AlignLeftIcon },
  { action: 'alignCentre', icon: AlignCenterHorizontalIcon },
  { action: 'alignRight', icon: AlignRightIcon },
  { action: 'alignTop', icon: AlignTopIcon },
  { action: 'alignMiddle', icon: AlignCenterVerticalIcon },
  { action: 'alignBottom', icon: AlignBottomIcon },
]
export const DISTRIBUTE: { action: Extract<Action, `distribute${string}`>; icon: Icon }[] = [
  { action: 'distributeHorizontal', icon: ArrowsHorizontalIcon },
  { action: 'distributeVertical', icon: ArrowsVerticalIcon },
]

export const COMBINE: { action: Action; icon: Icon }[] = [
  { action: 'booleanUnion', icon: UniteSquareIcon },
  { action: 'booleanSubtract', icon: SubtractSquareIcon },
  { action: 'booleanIntersect', icon: IntersectSquareIcon },
  { action: 'booleanExclude', icon: ExcludeSquareIcon },
]
