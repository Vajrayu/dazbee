'use client'

// A button for a change that is hard to undo, such as Remove, Hand over Owner or Leave, which asks once
// before it acts, in the app's own small menu: the question, then the change in its words and Cancel. A
// menu that asks only for some of its rows, as the role menu does, shows the same question in place of
// its rows (`ConfirmRows`).
import { type ReactElement, useEffect, useRef, useState } from 'react'

import { Menu, MenuItem } from '@/components/ui/menu.tsx'

export function ConfirmMenu({
  trigger,
  label,
  question,
  confirm,
  cancel,
  danger = false,
  onConfirm,
}: {
  /** The button that opens the menu. */
  trigger: ReactElement
  /** The menu's name, for a screen reader. */
  label: string
  question: string
  /** The words of the row that makes the change. */
  confirm: string
  cancel: string
  /** Whether the change takes something away, so its row reads in the danger colour. */
  danger?: boolean
  onConfirm: () => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <Menu
      trigger={trigger}
      open={open}
      onOpenChange={setOpen}
      label={label}
      place={{ side: 'bottom', align: 'end', sideOffset: 6, collisionPadding: 12 }}
      className="w-72"
    >
      <ConfirmRows question={question} confirm={confirm} cancel={cancel} danger={danger} onConfirm={onConfirm} />
    </Menu>
  )
}

/**
 * The question and its two rows, the change and Cancel, inside an open menu. With `focus`, the change takes
 * the focus as they show, for a menu whose focused row they replace.
 */
export function ConfirmRows({
  question,
  confirm,
  cancel,
  danger = false,
  focus = false,
  onConfirm,
}: {
  question: string
  confirm: string
  cancel: string
  danger?: boolean
  focus?: boolean
  onConfirm: () => void
}) {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (focus) box.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
  }, [focus])
  return (
    <div ref={box}>
      <p className="px-2.5 pt-1.5 pb-2 text-small leading-snug text-text [overflow-wrap:anywhere]">{question}</p>
      <MenuItem label={confirm} danger={danger} onSelect={onConfirm} />
      <MenuItem label={cancel} />
    </div>
  )
}
