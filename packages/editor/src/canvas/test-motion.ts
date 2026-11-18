// A stand-in for the screen's animation frames and the system's reduced motion, which the tests step by hand.
import type { Camera } from './camera.ts'
import type { EditorView, Motion } from './view.ts'

/**
 * Motion whose animation frames come only when the test asks, and whose reduced motion is on or
 * off as given. A draw the test asks for (`drawNext`) waits for the next animation frame too, in
 * the order it was asked for among the glide's steps, as the surface's does.
 */
export function testMotion(reduced = false) {
  /** What waits for the next animation frame, in the order it was asked for: the glide's steps and the draws. */
  let queue: { run: (at: number) => void; draw: boolean }[] = []
  const motion: Motion = {
    nextFrame: (run) => {
      const entry = { run, draw: false }
      queue.push(entry)
      return () => {
        queue = queue.filter((other) => other !== entry)
      }
    },
    reduced: () => reduced,
  }
  /** Runs a draw at the next animation frame. */
  function drawNext(run: () => void) {
    queue.push({ run, draw: true })
  }
  /** Runs what waits for an animation frame, at a time in milliseconds, in the order it was asked for. */
  function tick(at: number) {
    const due = queue
    queue = []
    for (const { run } of due) run(at)
  }
  /** How many of the glide's steps wait for an animation frame. */
  const waiting = () => queue.filter(({ draw }) => !draw).length
  /**
   * Runs an animation frame each 16 ms from `at` until none is waited for, each followed by the
   * redraw pass finding the frames in view, giving the view's camera after each.
   */
  function runOut(view: Pick<EditorView, 'camera' | 'findInView'>, at = 0): Camera[] {
    const steps: Camera[] = []
    for (let now = at; waiting() > 0; now += 16) {
      tick(now)
      view.findInView()
      steps.push(view.camera())
    }
    return steps
  }
  return { motion, drawNext, tick, runOut, waiting }
}
