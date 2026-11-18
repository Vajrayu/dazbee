// Each box layout's icon and word, what a box is shown as by its layout, and the icons of the two
// layers that hold others, a group and a box: the one map the layout section, Arrange, the menus
// and the layers panel read.
import type { Layout } from '@dazbee/schema'

import {
  ArrowsOutCardinalIcon,
  BoundingBoxIcon,
  ColumnsIcon,
  type Icon,
  RowsIcon,
  SelectionAllIcon,
  SquaresFourIcon,
} from '@/components/ui/icons.tsx'
import type { Messages } from '@/lib/i18n/index.ts'

/** The words for the layouts and for Box, by layout. */
export type Words = Messages['editor']['layouts']

/** A layout's or a box's icon and word. */
export type LayoutLook = { Icon: Icon; word: string }

/** The layouts, in the order the layout section offers them. */
export const LAYOUTS = ['free', 'row', 'column', 'grid'] as const satisfies readonly Layout[]

/** Each layout's icon; Phosphor names its icons by their bars, so a row's is Columns. */
const LAYOUT_ICON: Record<Layout, Icon> = {
  free: ArrowsOutCardinalIcon,
  row: ColumnsIcon,
  column: RowsIcon,
  grid: SquaresFourIcon,
}

/** The icons of the layers that hold others: a group, dashes round what it holds, and a Free box. */
export const HOLDER_ICONS = { group: SelectionAllIcon, box: BoundingBoxIcon } as const satisfies Record<string, Icon>

/** A layout's icon and word: Free, Row, Column or Grid. */
export const layoutLook = (layout: Layout, words: Words): LayoutLook => ({
  Icon: LAYOUT_ICON[layout],
  word: words[layout],
})

/** What a box is shown as by its layout, in the layers panel: its layout's look, or Box while Free. */
export const boxLook = (layout: Layout, words: Words): LayoutLook =>
  layout === 'free' ? { Icon: HOLDER_ICONS.box, word: words.box } : layoutLook(layout, words)
