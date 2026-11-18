// The computer the editor's tests run as, a Mac or another, whatever computer runs them.
import { onTestFinished } from 'vitest'

/** Whether the test runs as on a Mac. */
let mac = false

/** Runs the rest of the test as on a Mac or as on another computer, for the modules given `onMac` below. */
export function runAs(next: boolean) {
  mac = next
  onTestFinished(() => {
    mac = false
  })
}

/** Whether the test runs as on a Mac, which a test's harness gives its module to ask. */
export const onMac = () => mac
