// What the load test measures, step by step: how long each of the four things a person does took, and
// whether any of them passed its limits, a median over 1 s or a slowest over 3 s. A thing still waiting
// when the step ends counts as taking as long as it has waited so far, so a server that stops answering
// passes the limit rather than going unseen.

/** The four things measured. */
export type Measure = 'open' | 'edit' | 'brands' | 'upload'

/** One measure's timings over a step, in milliseconds. */
export interface Summary {
  count: number
  median: number
  slowest: number
  failures: number
}

/** Which limits a summary passed. */
export interface Passed {
  median: boolean
  slowest: boolean
  failures: boolean
}

export const MEASURES: readonly Measure[] = ['open', 'edit', 'brands', 'upload']

/** The limits: a median over 1 s or a slowest over 3 s. */
export const LIMITS = { medianMs: 1000, slowestMs: 3000 }

/** A step's timings: what finished, what failed, and what is still waiting, by measure. */
export function stepTimings(now: () => number = Date.now) {
  /** How long each finished one took, by measure. */
  const took = new Map<Measure, number[]>(MEASURES.map((m) => [m, []]))
  /** How many failed, by measure. */
  const failed = new Map<Measure, number>(MEASURES.map((m) => [m, 0]))
  /** When each one still waiting started, by measure. */
  const waiting = new Map<Measure, Set<{ at: number }>>(MEASURES.map((m) => [m, new Set()]))

  /** Starts timing one; its `done` records how long it took, its `failed` a failure. Only the first call counts. */
  function start(measure: Measure) {
    const entry = { at: now() }
    waiting.get(measure)?.add(entry)
    const end = () => waiting.get(measure)?.delete(entry) === true
    return {
      done: () => {
        if (end()) took.get(measure)?.push(now() - entry.at)
      },
      failed: () => {
        if (end()) failure(measure)
      },
    }
  }

  /** Counts a failure that no timing was running for, such as the sync server closing a tab. */
  function failure(measure: Measure) {
    failed.set(measure, (failed.get(measure) ?? 0) + 1)
  }

  /** Each measure's summary now, counting what still waits as taking its time so far. */
  function summaries(): Record<Measure, Summary> {
    const time = now()
    const entries = MEASURES.map((measure) => {
      const waited = [...(waiting.get(measure) ?? [])].map((entry) => time - entry.at)
      const all = [...(took.get(measure) ?? []), ...waited]
      return [measure, summarize(all, failed.get(measure) ?? 0)] as const
    })
    return Object.fromEntries(entries) as Record<Measure, Summary>
  }

  return { start, failure, summaries }
}

/** The limits a summary passed; none for a measure with nothing in it. */
export function passed(summary: Summary): Passed {
  return {
    median: summary.median > LIMITS.medianMs,
    slowest: summary.slowest > LIMITS.slowestMs,
    failures: summary.failures > 0,
  }
}

/** Whether a summary passed either time limit or failed. */
export function passedAny(summary: Summary): boolean {
  return Object.values(passed(summary)).some(Boolean)
}

/** The count, median and slowest of `times`, with `failures`. */
export function summarize(times: readonly number[], failures: number): Summary {
  const sorted = [...times].sort((a, b) => a - b)
  const middle = sorted.length / 2
  const median =
    sorted.length === 0
      ? 0
      : sorted.length % 2 === 1
        ? (sorted[Math.floor(middle)] as number)
        : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2
  return { count: sorted.length, median, slowest: sorted.at(-1) ?? 0, failures }
}
