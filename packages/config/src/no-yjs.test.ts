import { describe, expect, it } from 'vitest'

import { yjsPackagesIn } from './no-yjs.ts'

/** A pnpm lockfile, cut down to the parts a package's name appears in. */
const lockfile = (...packages: string[]) =>
  [
    "lockfileVersion: '9.0'",
    'importers:',
    '  packages/doc:',
    '    dependencies:',
    ...packages.flatMap((name) => [`      ${name}:`, '        specifier: ^1.0.0', '        version: 1.0.0']),
    'packages:',
    ...packages.map((name) => (name.startsWith('@') ? `  '${name}@1.0.0':` : `  ${name}@1.0.0:`)),
    'snapshots:',
    ...packages.map((name) => (name.startsWith('@') ? `  '${name}@1.0.0':` : `  ${name}@1.0.0:`)),
    '    dependencies:',
    ...packages.map((name) => `      ${name.startsWith('@') ? `'${name}'` : name}: 1.0.0`),
  ].join('\n')

describe('yjsPackagesIn', () => {
  it('finds yjs, a y- or @y/ package and a Hocuspocus package, each once', () => {
    expect(yjsPackagesIn(lockfile('yjs', 'y-indexeddb', '@y/protocols', '@hocuspocus/provider', 'zod'))).toEqual([
      '@hocuspocus/provider',
      '@y/protocols',
      'y-indexeddb',
      'yjs',
    ])
  })

  it('finds one named only as another package dependency', () => {
    expect(
      yjsPackagesIn(
        [lockfile('zod'), '  some-editor@2.0.0:', '    dependencies:', '      y-protocols: 1.0.7'].join('\n'),
      ),
    ).toEqual(['y-protocols'])
  })

  it('passes a lockfile of names that only look like one', () => {
    const near = [
      'array-includes',
      'safe-array-concat',
      'yargs-parser',
      'yaml',
      'lib0',
      'my-yjs',
      '@types/yjs-like',
      'yjsx',
    ]
    expect(yjsPackagesIn(lockfile(...near))).toEqual([])
  })
})
