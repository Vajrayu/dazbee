// The walk of several tabs on one design over the sync core's simulator (test-tabs.ts): every tab
// a plain store whose session takes random steps, with messages late, connections dropped, short
// server logs, and a server that restarts over slow, failing writes. TABS_SEEDS runs every seed it
// names (`TABS_SEEDS=1-1000`) with the tabs TABS_COUNT gives (`2`, the default, or `3-4`: three on
// even seeds and four on odd), and fails listing each seed that fails the end checks (a), (b) or
// (c) or a check of the walk; WALK_STEPS sets how many steps each walk takes.
import { describe, expect, it, vi } from 'vitest'

import type { Session } from './session.ts'
import type { Counts } from './sync/test-sim.ts'
import { registerBuggyCommands } from './test-commands.ts'
import { linkedDesign, testDesign } from './test-design.ts'
import { restartIds } from './test-ids.ts'
import {
  closeTabs,
  deliver,
  endChecks,
  openTabs,
  quiesce,
  readChecks,
  type SimTab,
  TAB_STEPS,
  tabsOn,
  tabsWalk,
  takeTabStep,
} from './test-tabs.ts'
import { stepsOf, walk, walkSeeds, walkSteps } from './test-walk.ts'

vi.mock('nanoid', () => import('./test-ids.ts'))

/** A walk of a few tabs takes a few seconds; a cold CI runner needs more than vitest's 5 s. */
const WALK_TIMEOUT = 120_000
/** Seeds for two tabs: between them they reject change sets, send follow-ups, catch a tab up with the whole design and restart. */
const TWO_TABS = [2, 4, 5, 6, 12]
/** Seeds for three tabs (even) and four (odd). */
const MORE_TABS = [6, 7, 9, 24]
/**
 * Seeds the merge gate's runs failed, with their tabs: a drag put back by a fault in it (3267), a
 * fault after an undo pressed in a gesture (4473, 4609) or a redo with nothing to redo (3834), a
 * page delete accepted after a rejected step, then a whole-design catch-up (4596), and parts the end
 * checks let stay gone (4152, 4683).
 */
const FOUND_BY_THE_GATE = [
  [3267, 2],
  [4473, 2],
  [3834, 2],
  [4596, 2],
  [4152, 3],
  [4609, 4],
  [4683, 4],
]
const TABS_SEEDS = walkSeeds([], 'TABS_SEEDS')

/** What each two-tab walk of TWO_TABS reached, once it passed. */
const reached = new Map<number, Counts>()

/** The two-tab walk of `seed`, noting what it reached as it closes. */
function walkCounted(seed: number) {
  const walker = tabsWalk(2)
  return walk(
    {
      ...walker,
      close: (world) => {
        reached.set(seed, { ...world.sim.counts })
        closeTabs(world)
      },
    },
    seed,
    walkSteps(200),
  )
}

describe('tabs on the sync core', () => {
  registerBuggyCommands()

  it(
    'fail on clients that never bring derived values up to date after crossing edits',
    async () => {
      // The walks of the first seeds, taken as they come (shortened, they would take long), until one fails.
      const fails = async (seed: number) => {
        restartIds()
        const world = await openTabs(seed, 2, { followUps: false })
        try {
          for (const step of stepsOf(seed, 200, TAB_STEPS)) await takeTabStep(world, step, () => {})
          await endChecks(world)
          return false
        } catch (error) {
          if (error instanceof Error && error.message.includes('derived values are stale')) return true
          throw error
        } finally {
          closeTabs(world)
        }
      }
      let failed = false
      for (let seed = 1; seed <= 12 && !failed; seed++) failed = await fails(seed)
      expect(failed).toBe(true)
    },
    WALK_TIMEOUT,
  )

  describe('a batch refused after a command in it wrote (seeds 23 and 46)', () => {
    /** Tab B's batch: a text fitted to a narrow box, then a refused reshape of that text. */
    const refusedBatch = (session: Session) =>
      expect(() =>
        session.batch(() => {
          session.run('text.fit', { id: 'headline', width: 120, height: 48 })
          session.run('node.reshape', { id: 'headline', d: 'M0 0L40 0L20 30Z', dx: 3, dy: 4, width: 40, height: 30 })
        }),
      ).toThrow('not a path')

    it('put back alone, as the editor puts it back, leaving no step', async () => {
      restartIds()
      const world = await tabsOn(testDesign(), 2)
      try {
        const { session } = world.tabs[1] as SimTab
        const was = session.design().nodes.headline
        refusedBatch(session)
        expect(session.design().nodes.headline).toEqual(was)
        expect(session.canUndo()).toBe(false)
        await quiesce(world)
      } finally {
        closeTabs(world)
      }
    })

    it('kept by the gesture it is in, with the boxes it wrote fitted', async () => {
      restartIds()
      const world = await tabsOn(testDesign(), 2)
      try {
        const { session } = world.tabs[1] as SimTab
        const gesture = session.beginGesture()
        refusedBatch(session)
        gesture.end()
        // The text keeps the width the batch gave it, and the height its words take at that width.
        expect(session.design().nodes.headline?.props).toMatchObject({ width: 120, height: 604.8 })
        await quiesce(world)
      } finally {
        closeTabs(world)
      }
    })
  })

  it('let a part stay gone in the end checks only when an untracked step deleted it, or what held it then', async () => {
    restartIds()
    const world = await tabsOn(linkedDesign(), 2)
    try {
      const [a, b] = world.tabs as [SimTab, SimTab]
      // The title leaves its group before an untracked step deletes the group, with the price in it.
      a.session.run('node.move', { id: 'title', parentId: 'sq' })
      a.session.untracked(() => a.session.run('node.delete', { ids: ['grp'] }))
      await quiesce(world)
      b.session.run('node.delete', { ids: ['title'] })
      // Nobody undoes the title's delete: it is gone, and the end checks say so.
      expect((await readChecks(world)).missing).toEqual(['title'])
    } finally {
      closeTabs(world)
    }
  })

  it('let a part stay gone when a delete its tab never heard accepted took it unknown to that tab (seed 4152)', async () => {
    restartIds()
    const world = await tabsOn(linkedDesign(), 2, { limits: { logChangeSets: 1 } })
    try {
      const [a, b] = world.tabs as [SimTab, SimTab]
      a.session.run('node.delete', { ids: ['badge'] })
      await deliver(world)
      // a brings the badge back as b, not knowing, deletes its frame: on the server the frame takes it.
      a.session.undo()
      b.session.run('frame.delete', { frameId: 'sq' })
      // One message at a time, the walk looking at the server after each, as it does.
      while (world.sim.design().get('frame', 'sq')) {
        await world.sim.step()
        world.gone.watchServer(world.sim.design())
      }
      // b is away before it hears, and comes back to the whole design: its undo never brings the badge back.
      world.sim.disconnect(1)
      for (const name of ['One', 'Two']) {
        a.session.run('node.rename', { id: 'other-x', name })
        await deliver(world)
      }
      await quiesce(world)
      expect(world.sim.counts.wholeDesigns).toBeGreaterThan(0)
      expect((await endChecks(world)).missing).toEqual([])
    } finally {
      closeTabs(world)
    }
  })

  it('let a part stay gone after a delete its tab never heard accepted only when that delete took it on the server', async () => {
    restartIds()
    const world = await tabsOn(linkedDesign(), 2, { limits: { logChangeSets: 1 } })
    try {
      const [a, b] = world.tabs as [SimTab, SimTab]
      // a deletes the title, heard accepted; then the group that held it, unheard, coming back to the whole design.
      a.session.run('node.delete', { ids: ['title'] })
      await deliver(world)
      a.session.run('node.delete', { ids: ['grp'] })
      while (world.sim.design().get('layer', 'grp')) {
        await world.sim.step()
        world.gone.watchServer(world.sim.design())
      }
      world.sim.disconnect(0)
      for (const name of ['One', 'Two']) {
        b.session.run('node.rename', { id: 'other-x', name })
        await deliver(world)
      }
      // The group's delete took the price, which a knew of, and not the title: the end checks look for all three.
      expect((await readChecks(world)).missing.sort()).toEqual(['grp', 'price', 'title'])
    } finally {
      closeTabs(world)
    }
  })

  it.each([
    [0, 1],
    [1, 0],
  ])(
    'let a part stay gone when it went with what an untracked step deleted, in one tab’s view though not in another’s (tabs %i and %i, seed 4683)',
    async (deleting, moving) => {
      restartIds()
      const world = await tabsOn(linkedDesign(), 2)
      try {
        const [a, b] = [world.tabs[deleting], world.tabs[moving]] as [SimTab, SimTab]
        // b puts the badge in the group while a is away; back, a's untracked delete of the group,
        // made without the badge in it, takes the badge on the server. b, away by then, takes its
        // move back: in its view the badge goes from where it was before the move.
        world.sim.disconnect(deleting)
        b.session.run('node.move', { id: 'badge', parentId: 'grp' })
        await deliver(world)
        world.sim.disconnect(moving)
        a.session.untracked(() => a.session.run('node.delete', { ids: ['grp'] }))
        world.sim.reconnect(deleting)
        await deliver(world)
        b.session.undo()
        expect((await readChecks(world)).missing).toEqual([])
      } finally {
        closeTabs(world)
      }
    },
  )

  it.each(TWO_TABS)(
    'hold one design whenever nothing is in flight, with current derived values and no undo of a later write, and lose no part once every tab undid everything (two tabs, seed %i)',
    (seed) => walkCounted(seed),
    WALK_TIMEOUT,
  )

  it.each(FOUND_BY_THE_GATE)(
    'do the same on the seeds the merge gate found (seed %i, %i tabs)',
    (seed, tabs) => walk(tabsWalk(tabs), seed, walkSteps(200)),
    WALK_TIMEOUT,
  )

  it.each(MORE_TABS)(
    'do the same with three and four tabs (seed %i)',
    (seed) => walk(tabsWalk(3 + (seed % 2)), seed, walkSteps(200)),
    WALK_TIMEOUT,
  )

  it(
    'reject change sets, send follow-ups, catch a tab up with the whole design and restart in the two-tab walks above',
    async () => {
      // Run alone, this test walks the seeds itself.
      for (const seed of TWO_TABS) if (!reached.has(seed)) await walkCounted(seed)
      const counts = { undos: 0, rejected: 0, followUps: 0, wholeDesigns: 0, restarts: 0 }
      for (const one of reached.values()) {
        for (const key of Object.keys(counts) as (keyof typeof counts)[]) counts[key] += one[key]
      }
      // Each one the walks never reached is listed.
      expect(Object.entries(counts).filter(([, count]) => count === 0)).toEqual([])
    },
    WALK_TIMEOUT,
  )

  it.runIf(TABS_SEEDS.length > 0)(
    'pass every check of the walk and the end checks for every seed in TABS_SEEDS',
    { timeout: 14_400_000 },
    async () => {
      const tabs = (seed: number) =>
        process.env.TABS_COUNT === '3-4' ? 3 + (seed % 2) : Number(process.env.TABS_COUNT ?? 2)
      const failures: string[] = []
      for (const seed of TABS_SEEDS) {
        restartIds()
        const world = await openTabs(seed, tabs(seed))
        const failed = (what: string) => failures.push(`seed ${seed} (${tabs(seed)} tabs): ${what}`)
        try {
          for (const step of stepsOf(seed, walkSteps(200), TAB_STEPS)) await takeTabStep(world, step, () => {})
          const { leftOut, repaired, missing } = await endChecks(world)
          if (leftOut.length > 0) failed(`(a) left out ${leftOut.join('; ')}`)
          if (repaired.length > 0) failed(`(b) repaired ${repaired.join('; ')}`)
          if (missing.length > 0) failed(`(c) gone ${missing.join(', ')}`)
        } catch (error) {
          failed((error instanceof Error ? error.message : String(error)).split('\n')[0] as string)
        } finally {
          closeTabs(world)
        }
      }
      expect(failures).toEqual([])
    },
  )
})
