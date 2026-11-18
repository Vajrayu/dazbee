// G8: no Yjs package is installed (ADR-0015). The sync server owns the design as plain records, so
// `yjs`, a `y-*` or `@y/*` package (its providers and protocols) or `@hocuspocus/*` in the lockfile means
// something brought the old document model back. Only a package's own name is matched, at the
// start of its line, so `array-includes` or `yargs-parser` pass.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** A lockfile line that names a Yjs package: as a package key (`yjs@13.6.33:`) or a dependency (`yjs: 13.6.33`). */
const YJS_LINE = /^\s*'?(yjs|y-[\w.-]+|@y\/[\w.-]+|@hocuspocus\/[\w.-]+)(?:@[^\s:']*)?'?:/

/** The Yjs packages a pnpm lockfile names, each once, sorted. */
export function yjsPackagesIn(lockfile: string): string[] {
  const names = new Set<string>()
  for (const line of lockfile.split('\n')) {
    const name = YJS_LINE.exec(line)?.[1]
    if (name) names.add(name)
  }
  return [...names].sort()
}

/** What is wrong with the repo at `root`: a line for each Yjs package its lockfile names. */
export function checkNoYjs(root: string): string[] {
  const lockfile = readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8')
  return yjsPackagesIn(lockfile).map(
    (name) => `pnpm-lock.yaml names ${name}: no Yjs package may be installed (ADR-0015)`,
  )
}
