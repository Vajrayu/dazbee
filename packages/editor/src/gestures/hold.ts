// Holding the pointer: a press that starts a gesture asks for the pointer to be held, so the stage
// hears it wherever it goes until it is let go, and whoever sent the press asks afterwards whether
// to hold it.

export interface EditorHold {
  /** Asks for the pointer to be held from the press being handled. */
  hold(): void
  /** Whether the pointer was asked to be held since this was last asked. */
  taken(): boolean
}

export function editorHold(): EditorHold {
  /** Whether a hold was asked for since `taken` last answered. */
  let asked = false

  function hold() {
    asked = true
  }
  function taken() {
    const was = asked
    asked = false
    return was
  }

  return { hold, taken }
}
