// Deletes the load test's workspace (load-workspace.ts): its rows, the people made for it and its folder
// in storage. Then it counts what is left, table by table and in storage, says the counts, and exits 1
// when anything is. It runs the way setup.ts does:
//
//   node apps/api/load/clean.ts <workspace id>
//
// Settings: DATABASE_URL and the STORAGE_ settings, as the API has them.
import { openDatabase } from '@dazbee/db'
import { openStorage, storageSettings } from '@dazbee/storage'

import { deleteLoadWorkspace, folderOf, leftovers } from './load-workspace.ts'

const [workspaceId] = process.argv.slice(2)
if (!workspaceId) throw new Error('usage: clean.ts <workspace id>')
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is not set')

const storage = openStorage(storageSettings())
const { db, close } = openDatabase(databaseUrl, { max: 1 })
try {
  await deleteLoadWorkspace(db, storage, workspaceId)
  const left = await leftovers(db, storage, workspaceId)
  console.log(`rows holding ${workspaceId}, or an id starting with it:`)
  for (const [column, rows] of Object.entries(left.rows)) console.log(`  ${column}: ${rows}`)
  console.log(`storage ${folderOf(workspaceId)}: ${left.files} files`)
  const anyLeft = left.files > 0 || Object.values(left.rows).some((rows) => rows > 0)
  console.log(anyLeft ? 'something is left' : 'nothing is left')
  process.exitCode = anyLeft ? 1 : 0
} finally {
  await close()
}
