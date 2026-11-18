'use client'

// One layer's row in the layers panel's tree: its picture (`LayerPicture`) and name, and at its end
// a label and its hide and lock toggles, which act on this layer alone. A mask's label is Mask;
// else the label is "only here" when none of its frame's linked frames holds a copy of it, or the
// kind: a box's layout (Row, Column, Grid, or Box while Free), or Group. The toggles that are on sit
// at the row's end, the label just before them; hovered, the toggles that are off show before them,
// and a click keeps the toggles where they are until the pointer leaves. The panel hands every row
// one set of handlers, so a row renders again only when what it shows changes.
import { memo, useState } from 'react'

import { isMask } from '@dazbee/doc'
import { layoutOf } from '@dazbee/schema'

import { boxLook } from '@/components/editor/box-layouts.ts'
import { isLocked } from '@/components/editor/layer-looks.ts'
import { DROP_LINE } from '@/components/editor/styles.ts'
import { useViewOnly } from '@/components/editor/view-only.tsx'
import { EyeIcon, EyeSlashIcon, type Icon, LockSimpleIcon, LockSimpleOpenIcon } from '@/components/ui/icons.tsx'
import { LIT_ROW } from '@/components/ui/looks.ts'
import { RenameField } from '@/components/ui/rename-field.tsx'
import { cn } from '@/lib/cn.ts'
import type { Row } from '@/lib/editor/layer-tree.ts'
import { useMessages } from '@/lib/i18n/client.tsx'
import { format } from '@/lib/i18n/index.ts'

import { LayerPicture } from './layer-picture.tsx'
import {
  LAYER_ROW,
  ROW_LABEL,
  ROW_LOOK,
  ROW_SELECTED,
  type RowApi,
  RowCaret,
  rowHandlers,
  rowPlace,
  type Where,
} from './tree-row.tsx'

type Toggle = 'hide' | 'lock'
/** Each toggle's slot at the row's end, counted from the end. */
type Slots = Record<Toggle, number>

const DRAG_TYPE = 'application/x-dazbee-layer'
/** A row's hide and lock toggles: their size and the gap between them; on a phone or a touch screen, a finger's. */
const TOGGLE = { size: 24, gap: 6 }
const ROOMY_TOGGLE = { size: 44, gap: 8 }
/** The room between the end label and the toggles that show. */
const LABEL_GAP = 5
/** A toggle's icon, centred in its button. */
const TOGGLE_ICON = 14
const TOGGLES: readonly Toggle[] = ['hide', 'lock']

/**
 * Where each toggle sits, counted from the row's end: those on at the end and those off before
 * them, each hide then lock; on a touch screen, where both always show, hide then lock.
 */
function slotsOf(hidden: boolean, locked: boolean, touch: boolean): Slots {
  const on = { hide: hidden, lock: locked }
  const order = touch
    ? TOGGLES
    : [...TOGGLES.filter((toggle) => !on[toggle]), ...TOGGLES.filter((toggle) => on[toggle])]
  return { hide: order.length - 1 - order.indexOf('hide'), lock: order.length - 1 - order.indexOf('lock') }
}

/** A layer's row. Rendered again only when something it shows changes. */
export const LayerRow = memo(function LayerRow({
  row,
  i,
  selected,
  focusable,
  renaming,
  open,
  hidden,
  drop,
  picture,
  pitch,
  touch: touchScreen,
  api,
}: {
  row: Row
  i: number
  selected: boolean
  focusable: boolean
  renaming: boolean
  open: boolean
  hidden: boolean
  drop: Where | null
  picture: string | null
  /** The rows' height on this screen; roomier on a phone or a touch screen, with targets a finger can hit. */
  pitch: number
  /** The screen is one a finger works without hover: both toggles always show. */
  touch: boolean
  api: RowApi
}) {
  const t = useMessages()
  // A tab that may only view drags no row, and shows only the toggles that are on, turned off.
  const viewOnly = useViewOnly()
  const touch = touchScreen && !viewOnly
  // The toggles' slots as a click left them, kept until the pointer leaves the row.
  const [held, setHeld] = useState<Slots | null>(null)
  const { id, node, depth } = row
  const locked = isLocked(node)
  const mask = isMask(node)
  const roomy = pitch > LAYER_ROW
  const toggle = roomy ? ROOMY_TOGGLE : TOGGLE
  const slots = held ?? slotsOf(hidden, locked, touch)
  // The toggles that show at rest: both on a touch screen, else those on.
  const atRest = touch ? 2 : Number(hidden) + Number(locked)
  // Hovered or focused, the label fades in place to make room for the toggles that show then.
  const fades = held !== null || atRest < 2
  /** A toggle's click: the toggles stay where they are until the pointer leaves. */
  const holding = (act: () => void) => () => {
    if (!touch) setHeld(slots)
    act()
  }
  const handlers = rowHandlers(api, row, i)
  // A box is named by its layout, a group as a group.
  const kind =
    node.type === 'box'
      ? boxLook(layoutOf(node.props), t.editor.layouts).word
      : node.type === 'group'
        ? t.editor.layouts.group
        : null
  // The end label: Mask for a mask, else "only here" when the layer is, else a box's or group's kind.
  const label = mask ? t.editor.layersPanel.mask : row.onlyHere ? t.editor.layersPanel.onlyHere : kind
  const labelId = mask ? 'layer-mask' : row.onlyHere ? 'layer-only-here' : 'layer-kind'
  return (
    <div
      key={id}
      role="treeitem"
      data-layer={id}
      data-row={id}
      aria-level={depth + 1}
      aria-setsize={row.siblings}
      aria-posinset={row.position}
      aria-selected={selected}
      aria-expanded={row.hasChildren ? open : undefined}
      data-drop={drop ?? undefined}
      tabIndex={focusable ? 0 : -1}
      draggable={!renaming && !viewOnly}
      {...handlers}
      onDragStart={(event) => {
        api.dragStart(id)
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData(DRAG_TYPE, id)
      }}
      onDragEnd={() => api.dragEnd()}
      onPointerLeave={() => {
        setHeld(null)
        handlers.onPointerLeave()
      }}
      style={rowPlace(i, depth, pitch)}
      className={cn(
        ROW_LOOK,
        'font-medium',
        selected ? ROW_SELECTED : LIT_ROW,
        drop === 'into' && 'ring-2 ring-accent ring-inset',
        hidden && 'text-subtle',
      )}
    >
      {drop === 'above' && <span aria-hidden className={cn(DROP_LINE, '-top-px')} />}
      {drop === 'below' && <span aria-hidden className={cn(DROP_LINE, '-bottom-px')} />}
      <RowCaret shown={row.hasChildren} open={open} name={node.name} onToggle={() => api.toggle(id)} />
      <LayerPicture node={node} picture={picture} selected={selected} />
      {renaming ? (
        <RenameField
          name={node.name}
          label={format(t.editor.layersPanel.rename, { name: node.name })}
          inputName="layer-name"
          maxLength={120}
          className="h-6 min-w-0 flex-1 rounded-row border border-accent bg-raised px-1.5 text-small outline-none"
          onDone={(name, byKey) => api.renamed(id, name, node.name, byKey)}
        />
      ) : (
        <span data-testid="layer-name" className="min-w-0 flex-1 truncate">
          {node.name}
        </span>
      )}
      {/* The row's end, always as wide as both toggles, so the name never shortens as they show. */}
      {!renaming && (
        <span
          className="relative flex shrink-0 items-center justify-end self-stretch"
          style={{ minWidth: 2 * toggle.size + toggle.gap }}
        >
          {label !== null && (
            <span
              data-testid={labelId}
              className={cn(
                ROW_LABEL,
                'transition-opacity duration-[var(--chrome-fast)]',
                fades && 'group-hover:opacity-0 group-focus-visible:opacity-0',
              )}
              // With no toggle showing, it ends where the toggles' icons end.
              style={{
                marginInlineEnd:
                  atRest > 0
                    ? atRest * toggle.size + (atRest - 1) * toggle.gap + LABEL_GAP
                    : (toggle.size - TOGGLE_ICON) / 2,
              }}
            >
              {label}
            </span>
          )}
          <RowToggle
            on={hidden}
            label={format(hidden ? t.editor.layersPanel.show : t.editor.layersPanel.hide, { name: node.name })}
            state={hidden ? 'hidden' : 'shown'}
            onToggle={holding(() => api.hide(id, !hidden))}
            icon={hidden ? EyeSlashIcon : EyeIcon}
            end={slots.hide * (toggle.size + toggle.gap)}
            size={toggle.size}
            testId="layer-hide"
          />
          <RowToggle
            on={locked}
            label={format(locked ? t.editor.layersPanel.unlock : t.editor.layersPanel.lock, { name: node.name })}
            onToggle={holding(() => api.lock(id, !locked))}
            icon={locked ? LockSimpleIcon : LockSimpleOpenIcon}
            end={slots.lock * (toggle.size + toggle.gap)}
            size={toggle.size}
            testId="layer-lock"
          />
        </span>
      )}
    </div>
  )
})

/**
 * Lock or hide on a row, `end` pixels from the row's end: shown while the row is hovered or
 * focused, on a touch screen, and always while it is on.
 */
function RowToggle({
  on,
  label,
  state,
  onToggle,
  icon: ToggleIcon,
  end,
  size,
  testId,
}: {
  on: boolean
  label: string
  state?: string
  onToggle: () => void
  icon: Icon
  end: number
  size: number
  testId: string
}) {
  // A tab that may only view shows a layer hidden or locked, turned off, and no toggle that is off.
  const viewOnly = useViewOnly()
  if (viewOnly && !on) return null
  return (
    <button
      type="button"
      disabled={viewOnly}
      tabIndex={-1}
      aria-label={label}
      aria-pressed={on}
      data-state={state}
      data-testid={testId}
      onClick={(event) => {
        event.stopPropagation()
        onToggle()
      }}
      onDoubleClick={(event) => event.stopPropagation()}
      style={{ insetInlineEnd: end, width: size, height: size }}
      className={cn(
        'absolute inset-y-0 my-auto grid cursor-pointer place-items-center rounded-[6px] text-subtle hover:bg-hover hover:text-text active:bg-pressed',
        // Off, it shows while the row is hovered or focused, and always on a screen without hover,
        // so nothing a finger can't see acts on a tap.
        !on && 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 [@media(hover:none)]:opacity-100',
      )}
    >
      <ToggleIcon size={TOGGLE_ICON} aria-hidden />
    </button>
  )
}
