'use client'

// The frame stepper, the row at the top of the layers panel: ‹, the shown frame's swatch of its
// background, its name and its size, and ›. The arrows step through the page's frames by order,
// wrapping round, changing only the frame whose layers the panel lists; with one frame on the page
// they don't show, their room kept so the name stays where it is. A click on the name picks the
// frame and a double click renames it in place; a layer of the frame dropped on the row goes to the
// frame's top.
import type { DragEvent, KeyboardEvent, ReactNode } from 'react'

import type { Frame } from '@dazbee/schema'

import { SizeText } from '@/components/editor/size-text.tsx'
import { MIXED_COLOUR } from '@/components/editor/styles.ts'
import { CaretLeftIcon, CaretRightIcon } from '@/components/ui/icons.tsx'
import { FOCUS_RING, LIT_ROW } from '@/components/ui/looks.ts'
import { RenameField } from '@/components/ui/rename-field.tsx'
import { Tooltip } from '@/components/ui/tooltip.tsx'
import { cn } from '@/lib/cn.ts'
import { ARROW_KEYS } from '@/lib/editor/frame-stepper.ts'
import { useMessages } from '@/lib/i18n/client.tsx'
import { format } from '@/lib/i18n/index.ts'

import { LAYER_ROW, PICTURE, ROW_INSET, ROW_LABEL, ROW_SELECTED } from './tree-row.tsx'

/** An arrow's square, as drawn; on a phone or a touch screen, a 44 px target a finger can hit. */
const ARROW = 28
const ROOMY_ARROW = 44
/** The arrows' look: a quiet icon that lights under the pointer and presses in. */
const ARROW_LOOK = `grid shrink-0 cursor-pointer place-items-center rounded-[8px] text-muted transition-colors duration-[var(--chrome-fast)] ${LIT_ROW} ${FOCUS_RING}`

/** The frame stepper. `onStep` shows the frame before (-1) or after (1) the shown one. */
export function FrameStepper({
  frameId,
  frame,
  steps,
  picked,
  renaming,
  dropInto,
  swatch,
  pitch,
  onStep,
  onPick,
  onRename,
  onRenamed,
  onNameKey,
  onDragOver,
  onDragLeave,
  onDrop,
  nameRef,
}: {
  frameId: string
  frame: Frame
  /** The page has another frame to step to: the arrows show. */
  steps: boolean
  picked: boolean
  renaming: boolean
  /** A layer dragged over the row would go to the frame's top. */
  dropInto: boolean
  /** The frame's background as its swatch shows it: a colour, see-through or not, mixed for an image, or none. */
  swatch: string
  /** The rows' height on this screen; roomier on a phone or a touch screen, with targets a finger can hit. */
  pitch: number
  onStep: (by: 1 | -1) => void
  onPick: () => void
  onRename: () => void
  onRenamed: (name: string | null, byKey: boolean) => void
  /** A key on the name: what the panel does with it, as Enter or F2 renaming the frame. */
  onNameKey: (event: KeyboardEvent<HTMLButtonElement>) => void
  onDragOver: (event: DragEvent<HTMLElement>) => void
  onDragLeave: () => void
  onDrop: (event: DragEvent<HTMLElement>) => void
  /** The name's button, which the tree's outward arrow key focuses from a top-level layer. */
  nameRef: (el: HTMLButtonElement | null) => void
}) {
  const t = useMessages()
  const arrow = pitch > LAYER_ROW ? ROOMY_ARROW : ARROW
  return (
    <div
      role="group"
      aria-label={t.editor.layersPanel.stepper}
      data-testid="frame-stepper"
      data-frame={frameId}
      data-drop={dropInto ? 'into' : undefined}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      // An arrow key on the row's buttons never reaches the stage to move a layer; in the rename
      // field it moves the caret.
      onKeyDown={(event) => {
        if (event.target instanceof HTMLInputElement || !ARROW_KEYS.includes(event.key)) return
        event.preventDefault()
        event.stopPropagation()
      }}
      className={cn(
        'flex shrink-0 items-center gap-1 border-b border-line',
        'max-sm:gap-2 [@media(hover:none)]:gap-2',
        dropInto && 'ring-2 ring-accent ring-inset',
      )}
      style={{ height: pitch, paddingInline: ROW_INSET + 6 }}
    >
      <StepArrow shown={steps} label={t.editor.layersPanel.previousFrame} size={arrow} onClick={() => onStep(-1)}>
        <CaretLeftIcon size={13} weight="bold" aria-hidden className="rtl:-scale-x-100" />
      </StepArrow>
      {renaming ? (
        <RenameField
          name={frame.name}
          label={format(t.editor.frames.nameOf, { name: frame.name })}
          inputName="frame-name"
          maxLength={120}
          className="h-7 min-w-0 flex-1 rounded-row border border-accent bg-raised px-1.5 text-small font-bold outline-none"
          onDone={onRenamed}
        />
      ) : (
        <button
          ref={nameRef}
          type="button"
          data-testid="frame-name"
          onClick={onPick}
          aria-pressed={picked}
          title={frame.name}
          onDoubleClick={onRename}
          onKeyDown={onNameKey}
          className={cn(
            'flex h-full min-w-0 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-[8px] px-1.5 text-small transition-colors duration-[var(--chrome-fast)]',
            FOCUS_RING,
            picked ? ROW_SELECTED : LIT_ROW,
          )}
          style={{ height: arrow }}
        >
          {/* Over a checkerboard, so a see-through background shows as one; its edge stays neutral when picked. */}
          <span
            aria-hidden
            data-testid="frame-swatch"
            className="checker relative shrink-0 overflow-hidden rounded-[5px] border border-line"
            style={{ width: PICTURE - 4, height: PICTURE - 4 }}
          >
            <span
              className="absolute inset-0"
              style={{ background: swatch === 'none' ? 'transparent' : swatch === 'mixed' ? MIXED_COLOUR : swatch }}
            />
          </span>
          {/* Its own direction, so a name in another script is cut at its end. */}
          <span dir="auto" className="min-w-0 truncate font-bold">
            {frame.name}
          </span>
          <SizeText size={frame} short className={ROW_LABEL} />
        </button>
      )}
      <StepArrow shown={steps} label={t.editor.layersPanel.nextFrame} size={arrow} onClick={() => onStep(1)}>
        <CaretRightIcon size={13} weight="bold" aria-hidden className="rtl:-scale-x-100" />
      </StepArrow>
    </div>
  )
}

/** An arrow of the stepper, a button named by `label`; while not `shown`, an empty space of its size. */
function StepArrow({
  shown,
  label,
  size,
  onClick,
  children,
}: {
  shown: boolean
  label: string
  size: number
  onClick: () => void
  children: ReactNode
}) {
  if (!shown) return <span aria-hidden data-testid="frame-step-room" className="shrink-0" style={{ width: size }} />
  return (
    <Tooltip label={label} side="bottom" plain>
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        onDoubleClick={(event) => event.stopPropagation()}
        className={ARROW_LOOK}
        style={{ width: size, height: size }}
      >
        {children}
      </button>
    </Tooltip>
  )
}
