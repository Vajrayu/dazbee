// Makes the load test's workspace (load-workspace.ts) and writes what editors.ts needs, the session
// tokens among it, to a file only its owner reads. It says the workspace's id and how many people it
// made, never a token. On the server it runs in a one-off container of the live API's image, with this
// folder mounted in the API's workspace so its packages resolve (see editors.ts for the whole run):
//
//   node apps/api/load/setup.ts <people> <file>
//
// Settings: DATABASE_URL and SESSION_SECRET, as the API has them.
import { writeFileSync } from 'node:fs'

import { openDatabase } from '@dazbee/db'
import { sessionSecret } from '@dazbee/session-token'

import { makeLoadWorkspace } from './load-workspace.ts'

const [peopleArg, file] = process.argv.slice(2)
const people = Number(peopleArg)
if (!Number.isInteger(people) || people < 1 || !file) throw new Error('usage: setup.ts <people> <file>')
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is not set')

const { db, close } = openDatabase(databaseUrl, { max: 1 })
try {
  const workspace = await makeLoadWorkspace(db, sessionSecret(), people)
  writeFileSync(file, JSON.stringify(workspace), { mode: 0o600 })
  console.log(`made workspace ${workspace.workspaceId} with ${people} people; wrote ${file}`)
} finally {
  await close()
}
