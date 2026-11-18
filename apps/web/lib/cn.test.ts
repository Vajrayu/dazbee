import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { cn, TEXT_SIZES } from './cn.ts'

describe('cn', () => {
  it('keeps a named text size beside a text colour', () => {
    expect(cn('text-label font-semibold', 'text-muted')).toBe('text-label font-semibold text-muted')
    expect(cn('text-small', 'text-accent-text')).toBe('text-small text-accent-text')
  })

  it('lets a later named text size win over an earlier one', () => {
    expect(cn('text-label', 'text-heading')).toBe('text-heading')
  })

  it('knows every text size tokens.css names', () => {
    const tokens = readFileSync(new URL('../app/styles/tokens.css', import.meta.url), 'utf8')
    const sizes = tokens.slice(tokens.indexOf('@theme static {'))
    const named = [...sizes.slice(0, sizes.indexOf('}')).matchAll(/^\s*--text-([a-z0-9-]+):/gm)]
      .map((m) => m[1] ?? '')
      .filter((name) => !name.includes('--'))
    expect(named.toSorted()).toEqual([...TEXT_SIZES].toSorted())
  })
})
