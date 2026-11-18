// Runs the gesture matrix's rows (run-row.ts) on a driver and writes its table of results, with
// the failures that have a ticket of their own told apart from those that have none; and shares
// the rows out in the parts Node's suite runs.
import type { MatrixDriver } from './driver.ts'
import { matrixDesign, type Subject, SUBJECTS } from './matrix-design.ts'
import { FRAME_IDS, type FrameId, GESTURES, type Row, runRow } from './run-row.ts'

/** Failures that have their own ticket: `subject gesture frame` → issue number. */
const KNOWN: Record<string, number> = Object.fromEntries([])
/** The parts each frame's rows are shared out in, so a suite runs a part in one test. */
const PARTS = 6
/** The name a suite's tests give each of the matrix's frames. */
const FRAME_NAMES: Record<FrameId, string> = { sq: 'square', wide: 'wide' }

/**
 * Opens the matrix's design and runs the rows in it; returns the table's rows and what failed
 * without a ticket. Each case is undone before the next, and a case that one undo doesn't put back
 * fails, so a share of the subjects gives the same results as the whole matrix.
 */
export async function runMatrix(driver: MatrixDriver, matrix: readonly Row[]) {
  await driver.open(matrixDesign)
  await driver.setSnapping(false)
  const rows: { key: string; result: string }[] = []
  const unexpected: string[] = []
  let shown: FrameId | null = null
  for (const row of matrix) {
    if (row.frameId !== shown) {
      await driver.fitFrame(row.frameId)
      await driver.drawn()
      shown = row.frameId
    }
    const failure = await runRow(driver, row)
    const key = `${row.subject} ${row.gesture} ${row.frameId}`
    if (failure === 'n/a') {
      rows.push({ key, result: 'n/a' })
      continue
    }
    const ticket = KNOWN[key]
    rows.push({
      key,
      result: failure ? (ticket ? `#${ticket}` : `FAIL: ${failure}`) : ticket ? `pass (fixed? #${ticket})` : 'pass',
    })
    if (failure && !ticket) unexpected.push(`${key}: ${failure}`)
    if (!failure && ticket) unexpected.push(`${key}: passes now; take #${ticket} out of KNOWN`)
  }
  const table = [
    '| Layer | Gesture | Frame | Result |',
    '|---|---|---|---|',
    ...rows.map(({ key, result }) => `| ${key.split(' ').join(' | ')} | ${result} |`),
  ].join('\n')
  return { rows, unexpected, table }
}

/** The matrix's rows in a frame for the given layers: every gesture on each, a layer after another. */
export const matrixRows = (frameId: FrameId, subjects: readonly Subject[]): Row[] =>
  subjects.flatMap((subject) => GESTURES.map((gesture) => ({ subject, gesture, frameId })))

/**
 * The whole matrix in the parts Node's suite runs it in, each frame's after another: in each, every
 * PARTS-th layer, so the containers and their children are shared out evenly. Each part has the
 * title its test is given and the file its table of results is written to.
 */
export const matrixParts = () => partsOf(SUBJECTS, PARTS, 'gesture-matrix')

/** `subjects` shared out in `parts` parts per frame, every `parts`-th layer in each, with report files named from `file`. */
function partsOf(subjects: readonly Subject[], parts: number, file: string) {
  return FRAME_IDS.flatMap((frameId) =>
    Array.from({ length: parts }, (_, i) => {
      const part = i + 1
      const shared = subjects.filter((_, at) => at % parts === i)
      return {
        frameId,
        part,
        subjects: shared,
        title: `every canvas gesture in the ${FRAME_NAMES[frameId]} frame, part ${part} of ${parts}: ${shared.join(', ')}`,
        file: `${file}-${frameId}-${part}.md`,
      }
    }),
  )
}
