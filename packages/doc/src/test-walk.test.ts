import { describe, expect, it, vi } from 'vitest'

import { registerBuggyCommands } from './test-commands.ts'
import { kindsDesign } from './test-design.ts'
import { restartIds } from './test-ids.ts'
import {
  FAULT_STEPS,
  openTab,
  SESSION_STEPS,
  shorten,
  type Step,
  stepsOf,
  takeSessionStep,
  type Walk,
  walk,
} from './test-walk.ts'

vi.mock('nanoid', () => import('./test-ids.ts'))

/** Steps taken on a session run hundreds of commands; a busy runner needs more than vitest's 5 s. */
const WALK_TIMEOUT = 30_000

/** Throws a check's failure, its name before the colon. */
const fail = (check: string): never => {
  throw new Error(`${check}: as the walk found it`)
}

/** A walk over a count that fails once the count reaches three. */
const counting: Walk<{ count: number }> = {
  kinds: { up: 1, down: 1, nothing: 2 },
  open: () => ({ count: 0 }),
  take: (world, { kind }) => {
    if (kind === 'up') world.count++
    if (kind === 'down') world.count = Math.max(0, world.count - 1)
    if (world.count >= 3) throw new Error('the count reached three')
  },
}

describe('stepsOf', () => {
  it('gives the same steps for the same seed, and others for another seed', () => {
    const kinds = { up: 1, down: 1 }
    expect(stepsOf(7, 50, kinds)).toEqual(stepsOf(7, 50, kinds))
    expect(stepsOf(8, 50, kinds)).not.toEqual(stepsOf(7, 50, kinds))
  })

  it('gives each kind about as often as its weight', () => {
    const steps = stepsOf(1, 4000, { often: 3, seldom: 1 })
    const often = steps.filter(({ kind }) => kind === 'often').length
    expect(often / steps.length).toBeGreaterThan(0.7)
    expect(often / steps.length).toBeLessThan(0.8)
  })
})

describe('walk', () => {
  it('passes a walk whose checks hold after every step', async () => {
    await walk({ ...counting, kinds: { down: 1, nothing: 1 } }, 3, 100)
  })

  it('fails with the seed and only the steps that still fail, shortest first', async () => {
    const failure = await walk(counting, 5, 300).then(
      () => undefined,
      (error: unknown) => String(error),
    )
    expect(failure).toMatch('seed 5')
    expect(failure).toMatch('the count reached three')
    const listed = failure?.split('\n').filter((line) => /^ +\d+\. /.test(line))
    expect(listed).toEqual(['  1. up', '  2. up', '  3. up'])
  })
})

describe('walk, shortening', () => {
  it('drops steps only while the same check fails, and gives the first failure beside the shortened one', async () => {
    // Fewer than ten steps fail another check at the end: dropping steps must not turn into that one.
    const failure = await walk({ ...counting, end: () => fail('the walk took fewer than ten steps') }, 5, 300).then(
      () => undefined,
      (error: unknown) => String(error),
    )
    const listed = failure?.split('\n').filter((line) => /^ +\d+\. /.test(line))
    expect(listed).toEqual(['  1. up', '  2. up', '  3. up'])
    expect(failure).not.toMatch('fewer than ten')
    expect(failure).toMatch(/first failed with: the count reached three/)
  })
})

describe('shorten', () => {
  it('keeps the failure and drops the steps that do not matter', async () => {
    const steps = stepsOf(11, 40, { a: 1 })
    const [first, second] = [steps[7] as Step, steps[31] as Step]
    const fails = (some: readonly Step[]) => some.indexOf(first) !== -1 && some.indexOf(second) > some.indexOf(first)
    expect(await shorten(steps, async (some) => fails(some))).toEqual([first, second])
  })
})

describe('takeSessionStep', () => {
  registerBuggyCommands()

  /** The steps a session walk takes on a fresh tab, in words, and the design it ends at. */
  const taken = (seed: number) => {
    restartIds()
    const tab = openTab(kindsDesign())
    const words = stepsOf(seed, 50, { ...SESSION_STEPS, ...FAULT_STEPS }).map((step) => takeSessionStep(tab, step))
    return { words, design: tab.session.design() }
  }

  it(
    'takes the same steps, to the same design, for the same seed',
    () => {
      const first = taken(21)
      const again = taken(21)
      expect(again.words).toEqual(first.words)
      expect(again.design).toEqual(first.design)
    },
    WALK_TIMEOUT,
  )

  it(
    'takes a command, a refused one, a gesture, a batch, an undo, a redo and a fault',
    () => {
      const kinds = new Set(taken(4).words.map((words) => words?.split(' ')[0]))
      expect([...kinds].sort()).toEqual(['batch', 'command', 'fault', 'gesture', 'redo', 'refused', 'undo'])
    },
    WALK_TIMEOUT,
  )
})
