// Puts our CanvasKit build into bin/: the files of the GitHub release that release.json names, each
// checked against its SHA-256. Fails when build/ changed since that release, so a stale build is
// never used. Runs on every pnpm install; files already in place and matching are kept. The files
// come from the release's public download address, or through the API as the release's assets
// when GITHUB_TOKEN or GH_TOKEN holds a token.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { download } from './download.mjs'
import { recipeHash } from './recipe.mjs'

const here = import.meta.dirname
const release = JSON.parse(readFileSync(join(here, 'release.json'), 'utf8'))
const recipe = recipeHash()
if (release.recipe !== recipe) {
  console.error(
    `@dazbee/canvaskit: build/ hashes to ${recipe}, but release.json is the build of ${release.recipe}.\n` +
      'Run the CanvasKit workflow on this branch and commit the release.json it prints.',
  )
  process.exit(1)
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const bin = join(here, 'bin')
mkdirSync(bin, { recursive: true })
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
/** Each asset's API address by its name, read once a file is missing: only with a token. */
let assets

/** Where a file of the release comes from, and the headers that fetch it. */
async function source(name) {
  if (!token) return { url: `https://github.com/${release.repo}/releases/download/${release.tag}/${name}`, headers: {} }
  const auth = { authorization: `Bearer ${token}`, 'x-github-api-version': '2022-11-28' }
  if (!assets) {
    const at = `https://api.github.com/repos/${release.repo}/releases/tags/${release.tag}`
    const found = JSON.parse(new TextDecoder().decode(await download(at, { headers: auth })))
    assets = new Map(found.assets.map((asset) => [asset.name, asset.url]))
  }
  const url = assets.get(name)
  if (!url) throw new Error(`@dazbee/canvaskit: release ${release.tag} has no ${name}`)
  return { url, headers: { ...auth, accept: 'application/octet-stream' } }
}

for (const [name, expected] of Object.entries(release.files)) {
  const file = join(bin, name)
  if (existsSync(file) && sha256(readFileSync(file)) === expected) continue
  const { url, headers } = await source(name)
  const bytes = await download(url, { headers })
  const actual = sha256(bytes)
  if (actual !== expected) throw new Error(`@dazbee/canvaskit: ${name} hashes to ${actual}, not ${expected}`)
  writeFileSync(`${file}.part`, bytes)
  renameSync(`${file}.part`, file)
  console.log(`@dazbee/canvaskit: fetched ${name} (${bytes.length} bytes) from ${release.tag}`)
}
