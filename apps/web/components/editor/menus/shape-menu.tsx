'use client'

// The shape tool in the tool dock (#44): one button draws the last shape picked, and the caret
// beside it opens a menu of every shape and the box, each with its key: rows of which one is picked,
// opening with the focus on the picked one.
import { useState } from 'react'

import type { ShapeMenuTool, ShortcutAction } from '@dazbee/editor'

import { HOLDER_ICONS } from '@/components/editor/box-layouts.ts'
import { DOCK_BUTTON, DOCK_OFF, DOCK_ON } from '@/components/editor/styles.ts'
import {
  ArrowUpRightIcon,
  CaretUpIcon,
  CircleIcon,
  type Icon,
  LineSegmentIcon,
  PentagonIcon,
  RectangleIcon,
  StarIcon,
} from '@/components/ui/icons.tsx'
import { LIT_ROW, MENU_KEY, TOUCH_ROW } from '@/components/ui/looks.ts'
import { Menu, MenuRadio, MenuRadios } from '@/components/ui/menu.tsx'
import { Tooltip, withShortcut } from '@/components/ui/tooltip.tsx'
import { cn } from '@/lib/cn.ts'
import { keyOf } from '@/lib/editor/shortcut-keys.ts'
import { useMessages } from '@/lib/i18n/client.tsx'

/** Each shape of the menu, with the action of its key in the shortcut table, if it has one. */
const SHAPES: { id: ShapeMenuTool; icon: Icon; action?: ShortcutAction }[] = [
  { id: 'rect', icon: RectangleIcon, action: 'toolRect' },
  { id: 'ellipse', icon: CircleIcon, action: 'toolEllipse' },
  { id: 'box', icon: HOLDER_ICONS.box, action: 'toolBox' },
  { id: 'polygon', icon: PentagonIcon },
  { id: 'star', icon: StarIcon },
  { id: 'line', icon: LineSegmentIcon, action: 'toolLine' },
  { id: 'arrow', icon: ArrowUpRightIcon, action: 'toolArrow' },
]

/** The shape the shape tool draws, as the menu lists it; the first for one it doesn't. */
const shapeOf = (shape: ShapeMenuTool) => SHAPES.find((s) => s.id === shape) ?? (SHAPES[0] as (typeof SHAPES)[number])

/** The icon of the shape the shape tool draws, as its dock button shows it. */
export const shapeIcon = (shape: ShapeMenuTool): Icon => shapeOf(shape).icon

export function ShapeTools({
  active,
  shape,
  onPick,
}: {
  active: boolean
  shape: ShapeMenuTool
  onPick: (shape: ShapeMenuTool) => void
}) {
  const t = useMessages()
  const [open, setOpen] = useState(false)
  const current = shapeOf(shape)
  const label = t.editor.shapes[current.id]

  return (
    <div
      role="group"
      aria-label={t.editor.shapes.menu}
      className={cn(
        'flex items-center rounded-[12px] transition-colors duration-[var(--chrome-fast)]',
        active && DOCK_ON,
      )}
    >
      <Tooltip label={current.action ? withShortcut(label, keyOf(current.action)) : label}>
        <button
          type="button"
          aria-label={label}
          aria-pressed={active}
          data-tool="shape"
          data-shape={current.id}
          onClick={() => onPick(current.id)}
          className={cn(DOCK_BUTTON, 'w-9 ps-0.5', active ? 'text-on-accent' : DOCK_OFF)}
        >
          <current.icon size={20} weight={active ? 'fill' : 'regular'} aria-hidden />
        </button>
      </Tooltip>
      <Menu
        trigger={
          <button
            type="button"
            aria-label={t.editor.shapes.more}
            data-testid="shape-menu"
            className={cn(
              DOCK_BUTTON,
              'w-4',
              active
                ? 'text-on-accent/80 hover:text-on-accent'
                : 'text-subtle hover:bg-hover hover:text-text active:bg-pressed',
            )}
          >
            <CaretUpIcon size={10} weight="bold" aria-hidden />
          </button>
        }
        tooltip={t.editor.shapes.more}
        open={open}
        onOpenChange={setOpen}
        label={t.editor.shapes.menu}
        place={{ side: 'top', align: 'center', sideOffset: 10 }}
        className="w-52 p-1"
      >
        <MenuRadios value={shape} onValueChange={(id) => onPick(id as ShapeMenuTool)}>
          {SHAPES.map(({ id, icon: ShapeIcon, action }) => (
            <MenuRadio
              key={id}
              value={id}
              label={t.editor.shapes[id]}
              data-shape={id}
              className={cn(
                `flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-row px-2 text-small outline-none transition-colors duration-[var(--chrome-fast)] ${LIT_ROW} focus-visible:bg-hover focus-visible:lit`,
                TOUCH_ROW,
                id === shape ? 'text-text' : 'text-muted',
              )}
            >
              <ShapeIcon
                size={16}
                weight={id === shape ? 'fill' : 'regular'}
                aria-hidden
                className={cn(id === shape && 'text-accent-text')}
              />
              <span className="flex-1 text-start">{t.editor.shapes[id]}</span>
              {action && <kbd className={MENU_KEY}>{keyOf(action)}</kbd>}
            </MenuRadio>
          ))}
        </MenuRadios>
      </Menu>
    </div>
  )
}
