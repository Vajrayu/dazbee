import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { TOUCH_FIELD } from './looks.ts'
import { Select } from './select.tsx'
import { TooltipProvider } from './tooltip.tsx'

const OPTIONS = [
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
]
/** A select's markup as first drawn, greyed for `why` or not, among the page's tooltips. */
const html = (value: string, why: string | null) =>
  renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(Select, {
        name: 'across',
        label: 'Constraint across',
        value,
        options: OPTIONS,
        onChange: () => {},
        placeholder: 'Mixed',
        why,
        className: 'h-8',
      }),
    ),
  )

describe('Select', () => {
  it('greyed, shows its picked option or its placeholder as the live field does, at the same touch size, and says why', () => {
    for (const value of ['right', '']) {
      const live = html(value, null)
      const greyed = html(value, 'The layer is locked')
      const shown = (markup: string) => /<span class="([^"]*)">([^<]*)<\/span>/.exec(markup)?.slice(1)
      expect(shown(greyed), value).toEqual(shown(live))
      for (const touch of TOUCH_FIELD.split(' ')) expect(greyed).toContain(touch)
      expect(greyed).toContain('aria-disabled="true"')
      expect(greyed).toContain('aria-description="The layer is locked"')
      expect(live).not.toContain('aria-disabled')
    }
  })
})
