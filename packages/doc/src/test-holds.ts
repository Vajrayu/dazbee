// How long work holds the event loop, for the timing tests: processor time, so a busy machine that
// keeps the process waiting adds nothing.

/**
 * How far, in ms, the processor clock may read behind the work done: it steps by 15.6 ms on
 * Windows, and by a microsecond elsewhere.
 */
const CLOCK_STEP_MS = process.platform === 'win32' ? 15.625 : 0

/** The processor time this process has used so far, in ms: its own work, whatever else the machine runs. */
function workMs() {
  const { user, system } = process.cpuUsage()
  return (user + system) / 1000
}

/** The processor time `run` takes, in ms. */
function workOf(run: () => void) {
  const before = workMs()
  run()
  return workMs() - before
}

/**
 * How long `run` holds the event loop, in ms: its wall time, counted as no longer than the
 * processor time this process used meanwhile, and one step of that clock, so a busy machine that
 * keeps the process waiting adds nothing. Processor time alone would count the work of the engine's
 * other threads (a parallel garbage collection, a compile), which holds nothing.
 */
export function holdOf(run: () => void) {
  const start = performance.now()
  const work = workOf(run)
  return Math.min(performance.now() - start, work + CLOCK_STEP_MS)
}

/**
 * Measures how long the event loop is held at a time while it runs: `stop` gives the longest hold, in
 * ms. A hold is the time between two turns of a 5 ms timer, counted as no longer than the processor
 * time this process used between them, and one step of that clock, so a busy machine that keeps the
 * process waiting adds nothing.
 */
export function watchHolds() {
  let last = performance.now()
  let worked = workMs()
  let longest = 0
  const timer = setInterval(() => {
    const now = performance.now()
    const work = workMs()
    longest = Math.max(longest, Math.min(now - last, work - worked + CLOCK_STEP_MS))
    last = now
    worked = work
  }, 5)
  return () => {
    clearInterval(timer)
    return longest
  }
}
