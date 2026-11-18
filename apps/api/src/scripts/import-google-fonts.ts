// Copies the Google Fonts families Dazbee offers, and the script fonts text falls back to, into our
// storage (#50): every family in both lists, or only those named, as in
// `pnpm --filter @dazbee/api fonts:google Inter "Noto Color Emoji"`. Run it once per environment, and
// again to pick up new families or Google's updates; from then on fonts load from our storage only.
// Settings come from the environment, as the API's do.
import { migrateDatabase, openDatabase } from '@dazbee/db'
import { GOOGLE_FONTS, SCRIPT_FONTS } from '@dazbee/fonts'
import { openStorage, storageSettings } from '@dazbee/storage'

import { importGoogleFamily } from '../fonts/google.ts'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is not set')
const named = process.argv.slice(2)
const families = [...GOOGLE_FONTS, ...SCRIPT_FONTS]
const unknown = named.filter((family) => !families.some((f) => f.family === family))
if (unknown.length > 0) throw new Error(`not in packages/fonts' GOOGLE_FONTS or SCRIPT_FONTS: ${unknown.join(', ')}`)
const wanted = named.length > 0 ? families.filter((f) => named.includes(f.family)) : families

const storage = openStorage(storageSettings())
if (process.env.STORAGE_CREATE_BUCKET === 'on') await storage.ensureBucket()
const { db, close } = openDatabase(databaseUrl)
try {
  await migrateDatabase(db)
  for (const family of wanted) {
    const copied = await importGoogleFamily(db, storage, family)
    console.log(`${family.family}: ${copied === 0 ? 'up to date' : `${copied} face${copied === 1 ? '' : 's'} copied`}`)
  }
} finally {
  await close()
}
