// The ids commands make in a walk, the same in every run of it: a walk's test file stands this
// module in for `nanoid` (`vi.mock('nanoid', () => import('./test-ids.ts'))`), and each walk
// counts again from the start as it opens (test-walk.ts).

/** The ids made since the count started again. */
let made = 0

/** The next id: `id-1`, `id-2` and so on. */
export function nanoid(): string {
  made += 1
  return `id-${made}`
}

/** Starts the count again, so the next walk makes the same ids as the last one. */
export function restartIds() {
  made = 0
}
