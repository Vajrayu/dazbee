import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { SizeText } from '@/components/editor/size-text.tsx'

const html = (props: Parameters<typeof SizeText>[0]) => renderToStaticMarkup(createElement(SizeText, props))

describe('SizeText', () => {
  it('shows width × height isolated left to right, so 720 × 900 reads in that order in Arabic', () => {
    expect(html({ size: { width: 720, height: 900 } })).toBe('<span dir="ltr">720 × 900</span>')
  })

  it("shows a chip's short size, and keeps left to right when a caller passes a direction", () => {
    const props = { size: { width: 1080, height: 1920 }, short: true, className: 'x', dir: 'rtl' }
    expect(html(props as Parameters<typeof SizeText>[0])).toBe('<span class="x" dir="ltr">1080×1920</span>')
  })
})
