import { readdirSync } from 'node:fs'
import { join } from 'node:path'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { Mascot, MASCOT_POSES, mascotSrc } from './mascot.tsx'

const PICTURES = join(import.meta.dirname, '../../public/mascot')

describe('MASCOT_POSES', () => {
  it('names exactly the pictures in public/mascot', () => {
    const files = readdirSync(PICTURES).sort()
    expect(files).toEqual(MASCOT_POSES.map((pose) => `${pose}.webp`).sort())
  })
})

describe('mascotSrc', () => {
  it('serves a pose from /mascot', () => {
    expect(mascotSrc('lost')).toBe('/mascot/lost.webp')
  })
})

describe('Mascot', () => {
  it('draws the pose at its size as a picture screen readers skip', () => {
    const html = renderToStaticMarkup(createElement(Mascot, { pose: 'shrug', size: 96 }))
    expect(html).toContain('src="/mascot/shrug.webp"')
    expect(html).toContain('alt=""')
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('width="96"')
    expect(html).toContain('height="96"')
    expect(html).toContain('mascot-bob')
    expect(html).toContain('loading="lazy"')
  })

  it('is 136 pixels when no size is given', () => {
    expect(renderToStaticMarkup(createElement(Mascot, { pose: 'lost' }))).toContain('width="136"')
  })
})
