// Turns of the event loop, one caller at a time: whole-design jobs take one each, so other work
// runs between any two (D8).

/**
 * Gives each caller a turn of the event loop of its own, one after another: a turn starts only in the
 * loop's iteration after the one before it started, so other work runs between any two.
 */
export function turns(): () => Promise<void> {
  let last = Promise.resolve()
  return () => {
    const turn = last.then(() => new Promise<void>((next) => setImmediate(next)))
    last = turn
    return turn
  }
}
