// The load test: how many people editing at once the server holds. It ramps simulated people
// (person.ts) in steps; each opens their own design, moves its frame every 2 s, and once a step loads
// the Brands page and uploads an image. At the end of each step it says, for each of the four, how many
// were timed, their median and slowest, and the failures, and it stops at the first step where any has
// a median over 1 s, a slowest over 3 s, or a failure (timings.ts). It talks to the web app and sync
// server only, as a browser does, so it runs from a developer's machine:
//
//   node tools/load/editors.ts <file> [--web https://app.dazbee.com] [--sync wss://sync.dazbee.com]
//     [--steps 5,10,20,30,40,60,80,100] [--step-seconds 60]
//
// The whole run against production, from the repo's root, with the server's SSH host as <server>:
//
//   1. Copy this folder to the server, and make the people in a one-off container of the live API,
//      with the folder mounted in the API's workspace so its packages resolve:
//        scp tools/load/{load-workspace,setup,clean}.ts <server>:/root/load/
//        ssh <server> 'mkdir -p -m 700 /root/load-out && chown 1000 /root/load-out && cd /opt/dazbee &&
//          docker compose -f deploy/compose.yml --project-directory . --env-file .env --env-file live/images.env
//          run --rm --no-deps -v /root/load:/repo/apps/api/load:ro -v /root/load-out:/out
//          api-$(cat live/api) node apps/api/load/setup.ts 100 /out/people.json'
//   2. Copy the file here, and remove it from the server:
//        scp <server>:/root/load-out/people.json . && ssh <server> rm -r /root/load-out
//   3. Run this, while `docker stats` and `docker ps` run on the server.
//   4. Once the sync server has unloaded the designs (a minute after the last tab leaves), clean up in
//      the same kind of container, with `node apps/api/load/clean.ts <workspace id>`, and delete the file.
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'

import type { LoadWorkspace } from './load-workspace.ts'
import { simulatedPerson } from './person.ts'
import { LIMITS, type Measure, MEASURES, passed, stepTimings, type Summary } from './timings.ts'
import { findSyncTokenAction, webAppAs } from './web-app.ts'

/** How long a step's newcomers take to arrive, spread evenly, before the step's other work starts. */
const ARRIVE_MS = 10_000

/** A step's Brands page loads and uploads start between its arrivals and this long before its end. */
const QUIET_END_MS = 5_000

/** The most failure reasons said each step; the step's summary counts them all. */
const FAILURES_SAID = 10

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    web: { type: 'string', default: 'https://app.dazbee.com' },
    sync: { type: 'string', default: 'wss://sync.dazbee.com' },
    steps: { type: 'string', default: '5,10,20,30,40,60,80,100' },
    'step-seconds': { type: 'string', default: '60' },
  },
})
const [file] = positionals
if (!file) throw new Error('usage: editors.ts <file> [--web URL] [--sync URL] [--steps 5,10,…] [--step-seconds 60]')
const webUrl = values.web.replace(/\/+$/, '')
const syncUrl = values.sync.replace(/\/+$/, '')
const stepMs = Number(values['step-seconds']) * 1000
if (!(stepMs >= ARRIVE_MS + QUIET_END_MS + 1000)) throw new Error('a step needs at least 16 seconds')
const workspace = JSON.parse(readFileSync(file, 'utf8')) as LoadWorkspace
const steps = values.steps.split(',').map(Number)
if (steps.some((n, i) => !Number.isInteger(n) || n < 1 || n > workspace.people.length || n <= (steps[i - 1] ?? 0)))
  throw new Error(`steps rise from 1 to at most the ${workspace.people.length} people the file holds`)

const say = (line: string) => console.log(`${new Date().toISOString().slice(11, 19)}  ${line}`)

say(`workspace ${workspace.workspaceId}: ${webUrl} and ${syncUrl}, steps of ${stepMs / 1000} s: ${steps.join(', ')}`)
const actionId = await findSyncTokenAction(
  webUrl,
  workspace.workspaceId,
  workspace.people[0] as LoadWorkspace['people'][0],
)
let timings = stepTimings()
let failuresSaid = 0
const people: ReturnType<typeof simulatedPerson>[] = []
const onFailure = (what: Measure, why: string) => {
  if (failuresSaid++ < FAILURES_SAID) say(`${what} failed: ${why}`)
}
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => stop(`by ${signal} at ${people.length} people`))

let stoppedAt: { people: number; passed: string[] } | null = null
for (const target of steps) {
  timings = stepTimings()
  failuresSaid = 0
  const opening: Promise<void>[] = []
  const newcomers = workspace.people.slice(people.length, target)
  newcomers.forEach((person, i) => {
    const simulated = simulatedPerson({
      person,
      web: webAppAs(webUrl, workspace.workspaceId, person, actionId),
      syncUrl,
      timings: () => timings,
      onFailure,
    })
    people.push(simulated)
    opening.push(wait((i * ARRIVE_MS) / newcomers.length).then(simulated.open))
  })
  for (const person of people) {
    void wait(at()).then(person.brandsPage)
    void wait(at()).then(person.upload)
  }
  say(`${target} people`)
  await wait(stepMs)
  await Promise.all(opening)
  const summaries = timings.summaries()
  say(`${target} people: ${MEASURES.map((m) => `${m} ${line(summaries[m])}`).join('; ')}`)
  const over = MEASURES.flatMap((m) => passedBy(m, summaries[m]))
  if (over.length > 0) {
    stoppedAt = { people: target, passed: over }
    break
  }
}
stop(
  stoppedAt
    ? `at ${stoppedAt.people} people: ${stoppedAt.passed.join(', ')}`
    : `no limit passed up to ${steps.at(-1)} people`,
)

/** When in a step a person's Brands page load or upload starts: at random between the arrivals and the quiet end. */
function at() {
  return ARRIVE_MS + Math.random() * (stepMs - ARRIVE_MS - QUIET_END_MS)
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

/** A summary in a few words: how many, median, slowest, failures. */
function line({ count, median, slowest, failures: failed }: Summary) {
  return `${count} timed, median ${Math.round(median)} ms, slowest ${Math.round(slowest)} ms, ${failed} failed`
}

/** The limits a measure passed, in words. */
function passedBy(measure: Measure, summary: Summary): string[] {
  const { median, slowest, failures: failed } = passed(summary)
  return [
    ...(median ? [`${measure}'s median passed ${LIMITS.medianMs} ms`] : []),
    ...(slowest ? [`${measure}'s slowest passed ${LIMITS.slowestMs} ms`] : []),
    ...(failed ? [`${measure} failed ${summary.failures} times`] : []),
  ]
}

/** Closes every tab and says where the ramp stopped. */
function stop(why: string): never {
  for (const person of people) person.close()
  say(`stopped ${why}`)
  process.exit(0)
}
