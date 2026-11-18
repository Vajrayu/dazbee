import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { EmptyState, NoMatch } from './empty-state.tsx'

describe('EmptyState', () => {
  it('draws the bee, the title, the line and the action', () => {
    const html = renderToStaticMarkup(
      createElement(EmptyState, {
        pose: 'box',
        title: 'No templates yet',
        line: 'Save a design as a template from the editor.',
        action: createElement('a', { href: '/x' }, 'Go'),
      }),
    )
    expect(html).toContain('src="/mascot/box.webp"')
    expect(html).toContain('<h2')
    expect(html).toContain('No templates yet</h2>')
    expect(html).toContain('Save a design as a template from the editor.</p>')
    expect(html).toContain('<a href="/x">Go</a>')
  })

  it('leaves out the line and the action it is not given, and takes the heading level and size asked for', () => {
    const html = renderToStaticMarkup(
      createElement(EmptyState, { pose: 'shrug', size: 96, title: 'None in this shape', titleAs: 'h1' }),
    )
    expect(html).toContain('None in this shape</h1>')
    expect(html).toContain('width="96"')
    expect(html).not.toContain('<p')
  })

  it('lays out tighter in a panel: a 96 px bee, smaller on a phone, and the title a paragraph under the panel heading', () => {
    const html = renderToStaticMarkup(
      createElement(EmptyState, { pose: 'layers', title: 'This frame is empty', tight: true }),
    )
    expect(html).toContain('width="96"')
    expect(html).toContain('max-sm:size-16')
    expect(html).toContain('This frame is empty</p>')
    expect(renderToStaticMarkup(createElement(EmptyState, { pose: 'layers', title: 'x' }))).not.toContain(
      'max-sm:size-16',
    )
  })
})

describe('NoMatch', () => {
  it('shows Daz searching, says nothing matches what was looked for, and suggests a shorter word', () => {
    const html = renderToStaticMarkup(createElement(NoMatch, { query: 'zebra' }))
    expect(html).toContain('src="/mascot/search.webp"')
    expect(html).toContain('Nothing matches “zebra”</p>')
    expect(html).toContain('Try a shorter word.</p>')
  })

  it('breaks a long word looked for inside its panel, rather than past its edges', () => {
    const html = renderToStaticMarkup(createElement(NoMatch, { query: 'a'.repeat(100) }))
    expect(html).toMatch(/<p class="[^"]*\[overflow-wrap:anywhere\][^"]*">Nothing matches/)
  })
})
