// Pointer and key inputs for the tests.
import type { KeyInput, KeyTarget, PointerInput } from './inputs.ts'

/** A pointer input at the stage's corner, a mouse's left button with nothing held: a move unless told another type. */
export const pointerInput = (extra: Partial<PointerInput> = {}): PointerInput => ({
  type: 'pointermove',
  at: { x: 0, y: 0 },
  button: 0,
  detail: 1,
  shiftKey: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  pointerType: 'mouse',
  ...extra,
})

/** What the page says of a key pressed on the stage, with nothing on the page holding the focus, unless told otherwise. */
export const keyTarget = (extra: Partial<KeyTarget> = {}): KeyTarget => ({
  field: false,
  control: false,
  dialog: 'none',
  toolbarArrow: false,
  buttonEnter: false,
  stage: true,
  ...extra,
})

/** A key input for a key by its code, pressed on the stage with nothing held: a keydown unless told another type. */
export const keyInput = (code: string, extra: Partial<KeyInput> = {}): KeyInput => ({
  type: 'keydown',
  code,
  key: code,
  shiftKey: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  repeat: false,
  target: keyTarget(),
  ...extra,
})
