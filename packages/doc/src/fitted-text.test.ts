import { describe, expect, it } from 'vitest'

import { type Layer, parseLayer } from '@dazbee/schema'

import { fittedText, type MeasureText } from './fitted-text.ts'
import { testMeasure } from './test-measure.ts'

/** A text layer as the read gives it, with `props` over a 600 by 100 box of 60 px type. */
function text(props: Record<string, unknown> = {}, bindings?: Record<string, string>): Layer {
  const parsed = parseLayer({
    type: 'text',
    parentId: 'sq',
    index: 'a0',
    link: 'title',
    name: 'Title',
    props: {
      x: 100,
      y: 100,
      width: 600,
      height: 100,
      text: 'Hello',
      style: { fontFamily: 'Noto Sans', fontSize: 60, color: '#111111FF' },
      ...props,
    },
    ...(bindings ? { bindings } : {}),
  })
  if (!parsed.success) throw new Error(parsed.errors.join('; '))
  return parsed.layer
}

describe('fitted text', () => {
  it('fit a text of auto height to its words at its width', () => {
    // Five letters of 60 px type are 150 px wide: one line, 72 px tall.
    expect(fittedText(text(), testMeasure)).toEqual({ width: 600, height: 72 })
    expect(fittedText(text({ width: 60 }), testMeasure)).toEqual({ width: 60, height: 216 })
  })

  it('fit both sides of a text of auto width to its words on one line', () => {
    expect(fittedText(text({ boxMode: 'autoWidth' }), testMeasure)).toEqual({ width: 150, height: 72 })
  })

  it('leave a text of a fixed box, and any other layer, unfitted', () => {
    expect(fittedText(text({ boxMode: 'fixed' }), testMeasure)).toBeUndefined()
    const shape = parseLayer({
      type: 'graphic',
      parentId: 'sq',
      index: 'a0',
      link: 'shape',
      name: 'Shape',
      props: { x: 0, y: 0, width: 10, height: 10, shape: { kind: 'rect' } },
    })
    if (!shape.success) throw new Error(shape.errors.join('; '))
    expect(fittedText(shape.layer, testMeasure)).toBeUndefined()
  })

  it('measure a text bound to a brand font in the family the kit gives it, as it is drawn', () => {
    const families: string[] = []
    const measure: MeasureText = (props, width) => {
      families.push(props.style.fontFamily)
      return testMeasure(props, width)
    }
    const bound = text({}, { fontFamily: 'brand:heading' })
    fittedText(bound, measure, { 'brand:heading': 'Inter' })
    // With no kit, or a blank family in it, it is drawn, so measured, in the family it stores.
    fittedText(bound, measure)
    fittedText(bound, measure, { 'brand:heading': '  ' })
    expect(families).toEqual(['Inter', 'Noto Sans', 'Noto Sans'])
  })
})
