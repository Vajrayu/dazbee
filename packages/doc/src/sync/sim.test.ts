// Convergence and undo in random sessions, as FigCraft's sim_tests.rs and undo_tests.rs: several
// tabs editing at once over links with random delays, with steps open while others' change sets
// arrive, undo and redo, dropped connections, short catch-up logs, failing and slow writes, server
// restarts and reloads, end with exactly the server's design, nothing lost or stored twice, and no
// undo or redo ever reverting what someone else wrote after the undoing tab saw it.
// SIM_SEEDS runs more seeds (`SIM_SEEDS=7001-9000`), each with its own mix (`sweepRun`), and
// SIM_CHECK_EACH=1 checks the design and every mirror after each step on those too.
import { describe, expect, it } from 'vitest'

import { linkedDesign } from '../test-design.ts'
import { walkSeeds } from '../test-walk.ts'
import type { Client } from './client.ts'
import { DesignState } from './state.ts'
import { openSim, type Sim } from './test-sim.ts'
import { groupHeights, randomEdit, staleGroups, withGroupHeights, writeDerived } from './test-sim-edits.ts'

interface Run {
  tabs: number
  rounds: number
  maxDelay: number
  undo: boolean
  drops: boolean
  /** A short catch-up log makes tabs that come back catch up with the whole design. */
  logChangeSets?: number
  checkEach?: boolean
  /** Writes that fail, stops between a write and its answers, folds, and restarts at random moments. */
  storage?: boolean
  /** Tabs reload from their tab copies at random moments: offline or online, mid-step, with change sets queued. */
  reloads?: boolean
  /**
   * Each edit writes the toy derived value (`groupHeights`); with `followUps`, tabs bring it up to
   * date after crossing edits, and the run fails when a group ends with a stale one.
   */
  derived?: { followUps: boolean }
  /** An open step previews its changes after its writes. */
  previews?: boolean
}

/** How often each storage fault comes when a run has them. */
const STORAGE = { lostWrite: 0.03, crashAfterStore: 0.03, maxLatency: 8 }

/** Runs one random session from `seed` and checks it converged with no violation. */
async function run(seed: number, r: Run): Promise<Sim> {
  const sim = await openSim({
    tabs: r.tabs,
    seed,
    maxDelay: r.maxDelay,
    design: r.derived ? withGroupHeights(linkedDesign()) : linkedDesign(),
    limits: r.logChangeSets === undefined ? {} : { logChangeSets: r.logChangeSets },
    checkEach: r.checkEach ?? true,
    ...(r.storage ? { storage: { ...STORAGE, foldEntries: 2 + (seed % 7) } } : {}),
    ...(r.derived?.followUps ? { recompute: groupHeights } : {}),
    ...(r.reloads ? { tabCopies: true } : {}),
  })
  let made = 0
  const names: (string | undefined)[] = []
  const kit = (i: number) => ({ dice: sim.dice, newId: () => `t${i}-${++made}` })
  const tab = (i: number) => sim.tabs[i] as Client
  const endOpen = (i: number) => {
    if (tab(i).stepOpen()) sim.send(i, tab(i).end(names[i] ?? 'edit'))
  }
  /** One random edit to `c`'s open step, with the derived values over what it changed when the run has them; then maybe a preview. */
  const editIn = (i: number) => {
    const c = tab(i)
    const before = r.derived ? DesignState.fromRecords(c.working().toRecords()) : undefined
    const name = randomEdit(c, kit(i))
    if (before) writeDerived(c, before, groupHeights)
    const preview = r.previews && sim.dice.chance(0.7) ? c.preview() : undefined
    if (preview) sim.send(i, [preview])
    return name
  }
  for (let round = 0; round < r.rounds; round++) {
    const i = sim.dice.below(r.tabs)
    const c = tab(i)
    const roll = sim.dice.below(14)
    if (r.undo && roll < 3) {
      endOpen(i)
      sim.send(i, roll < 2 ? c.undo() : c.redo())
    } else if (r.drops && roll === 3) {
      if (sim.isOnline(i)) sim.disconnect(i)
      else sim.reconnect(i)
    } else if (roll === 4 || c.stepOpen()) {
      // A step left open while messages arrive: more writes, then it ends or is cancelled.
      const next = c.stepOpen() ? sim.dice.below(4) : 3
      if (next === 0) sim.send(i, c.cancel())
      else if (next === 1) endOpen(i)
      else if (c.stepOpen()) editIn(i)
      else {
        c.open()
        names[i] = editIn(i)
      }
    } else {
      c.open()
      const name = editIn(i) ?? 'edit'
      sim.send(i, c.end(sim.dice.chance(0.1) ? null : name))
    }
    if (r.storage && sim.dice.chance(0.02)) await sim.restart(sim.dice.chance(0.5))
    if (r.reloads && sim.dice.chance(0.03)) sim.reload(sim.dice.below(r.tabs))
    for (let n = sim.dice.below(4); n > 0; n--) await sim.step()
  }
  for (const i of sim.tabs.keys()) {
    endOpen(i)
    sim.reconnect(i)
  }
  await sim.settle()
  const differs = sim.converged()
  if (differs !== undefined) throw new Error(`seed ${seed}: ${differs}`)
  if (sim.violations.length > 0) throw new Error(`seed ${seed}: ${sim.violations.join('\n')}`)
  const stale = r.derived?.followUps ? staleGroups(sim.design()) : []
  if (stale.length > 0) throw new Error(`seed ${seed}: groups with a stale height: ${stale.join(', ')}`)
  return sim
}

/**
 * The run each seed of SIM_SEEDS gets: 2 to 5 tabs, 200 rounds, delays of 1 to 20, drops on even
 * seeds, a log of 1 to 7 change sets on every third; by seed mod 5, storage faults and restarts
 * (1 and 3) and reloads (3 and 4).
 */
function sweepRun(seed: number): Run {
  return {
    tabs: 2 + (seed % 4),
    rounds: 200,
    maxDelay: 1 + (seed % 20),
    undo: true,
    drops: seed % 2 === 0,
    ...(seed % 3 === 0 ? { logChangeSets: 1 + (seed % 7) } : {}),
    checkEach: process.env.SIM_CHECK_EACH === '1',
    storage: seed % 5 === 1 || seed % 5 === 3,
    reloads: seed % 5 === 3 || seed % 5 === 4,
    derived: { followUps: true },
    previews: seed % 5 === 1 || seed % 5 === 4,
  }
}

/** The seeds of a test, from `first` on. */
const seeds = (first: number, count = 12) => Array.from({ length: count }, (_, n) => first + n)

describe('random sessions', () => {
  it('converge on the server design', { timeout: 60_000 }, async () => {
    let delivered = 0
    for (const seed of seeds(0)) {
      delivered += (await run(seed, { tabs: 4, rounds: 60, maxDelay: 12, undo: false, drops: false })).counts.delivered
    }
    expect(delivered).toBeGreaterThan(12 * 60)
  })

  it('converge with undo and redo, never reverting what others wrote', { timeout: 60_000 }, async () => {
    let undos = 0
    for (const seed of seeds(0)) {
      undos += (await run(seed, { tabs: 3, rounds: 80, maxDelay: 12, undo: true, drops: false })).counts.undos
    }
    expect(undos).toBeGreaterThan(100)
  })

  it('converge with dropped connections and short logs that need the whole design', { timeout: 60_000 }, async () => {
    let wholeDesigns = 0
    let rejected = 0
    for (const seed of seeds(20)) {
      const sim = await run(seed, { tabs: 3, rounds: 90, maxDelay: 12, undo: true, drops: true, logChangeSets: 4 })
      wholeDesigns += sim.counts.wholeDesigns
      rejected += sim.counts.rejected
    }
    expect(wholeDesigns).toBeGreaterThan(0)
    expect(rejected).toBeGreaterThan(0)
  })

  it(
    'converge through slow and failed writes, server restarts and folds, with nothing lost or stored twice',
    { timeout: 60_000 },
    async () => {
      const counts = { restarts: 0, lostWrites: 0, folds: 0, wholeDesigns: 0, answersLost: 0 }
      let most = 0
      for (const seed of seeds(60)) {
        const sim = await run(seed, { ...sweepRun(seed), rounds: 120, storage: true, checkEach: true })
        for (const key of Object.keys(counts) as (keyof typeof counts)[]) counts[key] += sim.counts[key]
        most = Math.max(most, sim.counts.mostInOneWrite)
      }
      expect(counts.restarts).toBeGreaterThan(10)
      expect(counts.lostWrites).toBeGreaterThan(0)
      expect(counts.folds).toBeGreaterThan(0)
      // Change sets were stored whose answers never reached their tab: it learned of them as it came back.
      expect(counts.answersLost).toBeGreaterThan(0)
      // What was committed while a write was in flight went in one write.
      expect(most).toBeGreaterThan(1)
    },
  )

  it(
    'converge when tabs reload from what they saved, with nothing lost or stored twice',
    { timeout: 60_000 },
    async () => {
      let reloads = 0
      for (const seed of seeds(80)) {
        const r = { ...sweepRun(seed), rounds: 120, storage: seed % 2 === 0, reloads: true, checkEach: true }
        reloads += (await run(seed, r)).counts.reloads
      }
      expect(reloads).toBeGreaterThan(20)
    },
  )

  it(
    'converge when a tab comes back with a long queue, sent at a pace the server takes',
    { timeout: 60_000 },
    async () => {
      const sim = await openSim({ tabs: 2, seed: 1, maxDelay: 5, design: linkedDesign() })
      const a = sim.tabs[0] as Client
      sim.disconnect(0)
      for (let n = 0; n < 500; n++) {
        a.open()
        a.write({ op: 'set', value: { part: 'layer', id: 'title', key: 'name' }, to: `Offline ${n}` })
        sim.send(0, a.end('rename'))
      }
      sim.reconnect(0)
      await sim.settle()
      expect([sim.converged(), sim.violations, sim.design().get('layer', 'title')?.name]).toEqual([
        undefined,
        [],
        'Offline 499',
      ])
      // The pacer held what went past its burst.
      expect(sim.counts.mostPaced).toBe(500)
    },
  )

  it(
    'leave no group with a stale derived height once authors send follow-ups, and leave some without them',
    { timeout: 60_000 },
    async () => {
      const r: Run = { tabs: 3, rounds: 120, maxDelay: 12, undo: true, drops: false }
      let stale = 0
      for (const seed of seeds(100)) {
        await run(seed, { ...r, derived: { followUps: true } })
        stale += staleGroups((await run(seed, { ...r, derived: { followUps: false } })).design()).length
      }
      expect(stale).toBeGreaterThan(0)
    },
  )

  it('show previews for display only, and none once everyone is caught up', { timeout: 60_000 }, async () => {
    let previews = 0
    for (const seed of seeds(120)) {
      const r = { ...sweepRun(seed), rounds: 120, previews: true, reloads: seed % 2 === 0, checkEach: true }
      previews += (await run(seed, r)).counts.previews
    }
    expect(previews).toBeGreaterThan(100)
  })

  const swept = walkSeeds([], 'SIM_SEEDS')
  it.runIf(swept.length > 0)('converge for every seed in SIM_SEEDS', { timeout: 3_600_000 }, async () => {
    const failures: string[] = []
    for (const seed of swept) {
      try {
        await run(seed, sweepRun(seed))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        failures.push(message.startsWith('seed') ? message : `seed ${seed}: ${message}`)
      }
    }
    expect(failures).toEqual([])
  })
})
