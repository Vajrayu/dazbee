// A layer's width or height set with its ratio kept, so the box keeps its shape; a size typed into
// fields; the size of the frame you are on; and sizes as the app writes them, rounded as the fields
// show them; and what is typed into a number field, worked out.
import { describe, expect, it } from 'vitest'

import type { DesignInput } from '@dazbee/schema'

import { LIMITS } from './limits.ts'
import {
  fieldEdit,
  fontSizeChange,
  latinDigits,
  parseTyped,
  shortSizeOf,
  sizeOf,
  sizePatch,
  sizeTo,
  sizeYouAreOn,
  tidy,
  typedSize,
} from './size.ts'

/** Two pages: the first holds a square and a story, the second a banner; with the pages' order reversed in their keys. */
const DESIGN = {
  pages: { p2: { name: 'Two', order: 'a1' }, p1: { name: 'One', order: 'a0' } },
  frames: {
    story: { pageId: 'p1', name: 'Story', width: 1080, height: 1920, x: 1280, y: 0, order: 'a1' },
    sq: { pageId: 'p1', name: 'Square', width: 1080, height: 1080, x: 0, y: 0, order: 'a0' },
    banner: { pageId: 'p2', name: 'Banner', width: 1200, height: 628, x: 0, y: 0, order: 'a0' },
  },
} satisfies Pick<DesignInput, 'pages' | 'frames'>
/** An editor showing a page, with a frame picked or layers selected in one. */
const on = ({
  page = 'p1',
  picked = null,
  selected = null,
}: {
  page?: string
  picked?: string | null
  selected?: string | null
}) => ({
  shownPage: () => page,
  pickedFrame: () => picked,
  selectedFrame: () => selected,
})

describe('sizePatch', () => {
  it('moves the other side of a layer whose ratio is locked, and only the side typed otherwise', () => {
    expect(sizePatch({ width: 200, height: 100, lockRatio: true }, 'width', 300)).toEqual({ width: 300, height: 150 })
    expect(sizePatch({ width: 200, height: 100 }, 'width', 300)).toEqual({ width: 300 })
    expect(sizePatch({ width: 200, height: 100, lockRatio: false }, 'height', 50)).toEqual({ height: 50 })
  })

  it('leaves out the other side where it stays as it is, and stops the longer side at the largest size, the ratio kept', () => {
    expect(sizePatch({ width: 200, height: 100, lockRatio: true }, 'width', 200)).toEqual({ width: 200 })
    expect(sizePatch({ width: 10, height: 100, lockRatio: true }, 'width', 1e9)).toEqual({
      width: LIMITS.any / 10,
      height: LIMITS.any,
    })
    expect(sizePatch({ width: 10, height: 100 }, 'width', 1e9)).toEqual({ width: LIMITS.any })
  })
})

describe('sizeTo', () => {
  it('moves the other side by the same factor', () => {
    expect(sizeTo({ width: 200, height: 100 }, 'width', 300, true)).toEqual({ width: 300, height: 150 })
    expect(sizeTo({ width: 200, height: 100 }, 'height', 50, true)).toEqual({ width: 100, height: 50 })
  })

  it('rounds the other side to hundredths, as the fields show it', () => {
    expect(sizeTo({ width: 300, height: 100 }, 'width', 100, true)).toEqual({ width: 100, height: 33.33 })
  })

  it('changes one side only without the ratio kept', () => {
    expect(sizeTo({ width: 200, height: 100 }, 'width', 300, false)).toEqual({ width: 300 })
  })

  it('changes one side only when the box has no ratio to keep', () => {
    expect(sizeTo({ width: 0, height: 100 }, 'width', 300, true)).toEqual({ width: 300 })
    expect(sizeTo({ width: 200, height: 0 }, 'height', 40, true)).toEqual({ height: 40 })
  })

  it('gives whole pixels when asked, as a frame takes them: the other side moved to keep the shape, or the side typed alone', () => {
    const whole = { whole: true }
    expect(sizeTo({ width: 1080, height: 1350 }, 'width', 864, true, whole)).toEqual({ width: 864, height: 1080 })
    expect(sizeTo({ width: 1080, height: 1350 }, 'height', 1080, true, whole)).toEqual({ width: 864, height: 1080 })
    expect(sizeTo({ width: 1080, height: 1350 }, 'width', 1000, true, whole)).toEqual({ width: 1000, height: 1250 })
    expect(sizeTo({ width: 300, height: 100 }, 'width', 100, true, whole)).toEqual({ width: 100, height: 33 })
    expect(sizeTo({ width: 1080, height: 1350 }, 'width', 864, false, whole)).toEqual({ width: 864 })
    expect(sizeTo({ width: 1080, height: 1350 }, 'width', 864.6, false, whole)).toEqual({ width: 865 })
    expect(sizeTo({ width: 1080, height: 1350 }, 'height', 1000.4, true, whole)).toEqual({ width: 800, height: 1000 })
  })

  it('keeps the shape of the size it is given, so steps from a size kept as Lock ratio turned on do not drift', () => {
    const kept = { width: 1080, height: 1350 }
    // Two steps of W from 1080 × 1350: from the size kept, H is 1352.5 rounded; from the last step's 1081 × 1351 it would be 1352.
    expect(sizeTo(kept, 'width', 1082, true, { whole: true })).toEqual({ width: 1082, height: 1353 })
    expect(sizeTo({ width: 1081, height: 1351 }, 'width', 1082, true, { whole: true })).toEqual({
      width: 1082,
      height: 1352,
    })
  })
})

describe('typedSize', () => {
  it('waits for both sides', () => {
    expect(typedSize('', '250')).toBeNull()
    expect(typedSize('300', '  ')).toBeNull()
  })

  it('reads a size within the limits, spaces and Arabic and Persian digits too, with no issue', () => {
    expect(typedSize('300', '250')).toEqual({ width: 300, height: 250, issues: [] })
    expect(typedSize(' 1080 ', '١٩٢٠')).toEqual({ width: 1080, height: 1920, issues: [] })
    expect(typedSize('۱۲۰۰', '628')).toEqual({ width: 1200, height: 628, issues: [] })
  })

  it('takes the sizes at the limits: 50 px on the short side, 8000 on the long one, 12 times as long as wide', () => {
    expect(typedSize('50', '600')).toEqual({ width: 50, height: 600, issues: [] })
    expect(typedSize('8000', '667')).toEqual({ width: 8000, height: 667, issues: [] })
    expect(typedSize('8000', '8000')).toEqual({ width: 8000, height: 8000, issues: [] })
  })

  it('names each side past the limits and why, and only that side', () => {
    expect(typedSize('49', '600')?.issues).toEqual([{ side: 'width', issue: 'short' }])
    expect(typedSize('600', '0')?.issues).toEqual([{ side: 'height', issue: 'short' }])
    expect(typedSize('8001', '1000')?.issues).toEqual([{ side: 'width', issue: 'long' }])
    expect(typedSize('300.5', '250')?.issues).toEqual([{ side: 'width', issue: 'whole' }])
    expect(typedSize('49', '9000')?.issues).toEqual([
      { side: 'width', issue: 'short' },
      { side: 'height', issue: 'long' },
    ])
  })

  it('names the long side of a size longer than 12 times its short one, when both sides are within the limits', () => {
    expect(typedSize('50', '601')?.issues).toEqual([{ side: 'height', issue: 'ratio' }])
    expect(typedSize('7300', '600')?.issues).toEqual([{ side: 'width', issue: 'ratio' }])
  })

  it('takes digits only, with at most one decimal point: letters, signs, exponents and hex read as not whole', () => {
    for (const text of ['12px', '-', '-300', '+300', '1e3', '0x64', '0b111', '1,080', '1.2.3', 'Infinity', '.'])
      expect(typedSize(text, '250')?.issues, text).toEqual([{ side: 'width', issue: 'whole' }])
    expect(typedSize('300.0', '250')).toEqual({ width: 300, height: 250, issues: [] })
    expect(typedSize('٣٠٠٫٥', '250')?.issues).toEqual([{ side: 'width', issue: 'whole' }])
  })
})

describe('sizeYouAreOn', () => {
  it('is the picked frame’s size, else that of the frame the selection is in', () => {
    expect(sizeYouAreOn(on({ picked: 'story' }), DESIGN)).toMatchObject({ width: 1080, height: 1920 })
    expect(sizeYouAreOn(on({ selected: 'story' }), DESIGN)).toMatchObject({ width: 1080, height: 1920 })
    expect(sizeYouAreOn(on({ page: 'p2', selected: 'story' }), DESIGN)).toMatchObject({ width: 1080, height: 1920 })
  })

  it('is the shown page’s first frame’s size with neither, else the cover frame’s, else a blank design’s', () => {
    expect(sizeYouAreOn(on({}), DESIGN)).toMatchObject({ width: 1080, height: 1080 })
    expect(sizeYouAreOn(on({ page: 'p2' }), DESIGN)).toMatchObject({ width: 1200, height: 628 })
    expect(sizeYouAreOn(on({ page: 'p3' }), DESIGN)).toMatchObject({ width: 1080, height: 1080 })
    const square = { ...DESIGN, frames: { banner: DESIGN.frames.banner } }
    expect(sizeYouAreOn(on({ page: 'p1' }), square)).toMatchObject({ width: 1200, height: 628 })
    expect(sizeYouAreOn(on({}), { ...DESIGN, frames: {} })).toMatchObject({ width: 1080, height: 1080 })
  })

  it('passes over a frame picked or selected in that is gone', () => {
    expect(sizeYouAreOn(on({ page: 'p2', picked: 'gone', selected: 'gone' }), DESIGN)).toMatchObject({
      width: 1200,
      height: 628,
    })
  })
})

describe('sizeOf', () => {
  it('puts a spaced times sign between the width and the height', () => {
    expect(sizeOf({ width: 1080, height: 1920 })).toBe('1080 × 1920')
  })
})

describe('shortSizeOf', () => {
  it('puts the times sign between the width and the height with no spaces', () => {
    expect(shortSizeOf({ width: 300, height: 250 })).toBe('300×250')
  })
})

describe('tidy', () => {
  it('rounds to hundredths', () => {
    expect(tidy(33.333)).toBe(33.33)
    expect(tidy(0.125)).toBe(0.13)
  })

  it('leaves a whole number whole', () => {
    expect(tidy(40)).toBe(40)
  })
})

describe('latinDigits', () => {
  it('writes Arabic-Indic and Persian digits and the Arabic decimal separator as Latin digits and a point', () => {
    expect(latinDigits('١٢٣٫٥')).toBe('123.5')
    expect(latinDigits('۴۵۶')).toBe('456')
  })

  it('leaves Latin digits, signs and letters as they are', () => {
    expect(latinDigits('-12.5px')).toBe('-12.5px')
  })
})

describe('parseTyped', () => {
  it('reads a number to set, a minus making it negative, with spaces around it', () => {
    expect(parseTyped('120')).toEqual({ set: 120 })
    expect(parseTyped('  12.5 ')).toEqual({ set: 12.5 })
    expect(parseTyped('.5')).toEqual({ set: 0.5 })
    expect(parseTyped('-40')).toEqual({ set: -40 })
  })

  it('works out each operator', () => {
    expect(parseTyped('100+20')).toEqual({ set: 120 })
    expect(parseTyped('100 - 20')).toEqual({ set: 80 })
    expect(parseTyped('6*7')).toEqual({ set: 42 })
    expect(parseTyped('84/2')).toEqual({ set: 42 })
    expect(parseTyped('10--5')).toEqual({ set: 15 })
  })

  it('multiplies and divides before it adds and takes away, and brackets first', () => {
    expect(parseTyped('2+3*4')).toEqual({ set: 14 })
    expect(parseTyped('20-12/4')).toEqual({ set: 17 })
    expect(parseTyped('(2+3)*4')).toEqual({ set: 20 })
    expect(parseTyped('2*(3+(4-1))')).toEqual({ set: 12 })
    expect(parseTyped('-(2+3)')).toEqual({ set: -5 })
  })

  it('shifts the value by what follows a leading +, and scales it by what follows a leading * or /', () => {
    expect(parseTyped('+20')).toEqual({ shift: 20 })
    expect(parseTyped('+-5')).toEqual({ shift: -5 })
    expect(parseTyped('+(2*5)')).toEqual({ shift: 10 })
    expect(parseTyped('*2')).toEqual({ scale: 2 })
    expect(parseTyped(' * 1.5')).toEqual({ scale: 1.5 })
    expect(parseTyped('/4')).toEqual({ scale: 0.25 })
    expect(parseTyped('/(1+1)')).toEqual({ scale: 0.5 })
  })

  it('takes a comma as the decimal mark as well as a point', () => {
    expect(parseTyped('12,5')).toEqual({ set: 12.5 })
    expect(parseTyped('1,5*2')).toEqual({ set: 3 })
    expect(parseTyped('*1,5')).toEqual({ scale: 1.5 })
  })

  it('reads Arabic-Indic and Persian digits and the Arabic decimal separator', () => {
    expect(parseTyped('١٢٫٥')).toEqual({ set: 12.5 })
    expect(parseTyped('+١٠')).toEqual({ shift: 10 })
    expect(parseTyped('۲*۳')).toEqual({ set: 6 })
  })

  it('reads nothing from a division by zero', () => {
    expect(parseTyped('5/0')).toBeNull()
    expect(parseTyped('1/(2-2)')).toBeNull()
    expect(parseTyped('/0')).toBeNull()
  })

  it('skips a unit after a number, after a space too, also inside a sum and an edit', () => {
    expect(parseTyped('12px')).toEqual({ set: 12 })
    expect(parseTyped('12 px')).toEqual({ set: 12 })
    expect(parseTyped('50%')).toEqual({ set: 50 })
    expect(parseTyped('45°')).toEqual({ set: 45 })
    expect(parseTyped('10px + 5')).toEqual({ set: 15 })
    expect(parseTyped('+10 px')).toEqual({ shift: 10 })
  })

  it('reads a number with an exponent, and an "e" with no digits after it as a unit', () => {
    expect(parseTyped('1e3')).toEqual({ set: 1000 })
    expect(parseTyped('1e12')).toEqual({ set: 1e12 })
    expect(parseTyped('2,5E-1')).toEqual({ set: 0.25 })
    expect(parseTyped('1e+2 + 1')).toEqual({ set: 101 })
    expect(parseTyped('*1e1')).toEqual({ scale: 10 })
    expect(parseTyped('2em')).toEqual({ set: 2 })
    expect(parseTyped('1e400')).toBeNull()
  })

  it('reads nothing from text it cannot read: letters alone, hex, a stray sign or bracket', () => {
    for (const text of ['abc', 'px', 'e3', '0x10', '5+', '++5', '**2', '(5', '5)', '()', '1.2.3', 'Infinity', '.'])
      expect(parseTyped(text), text).toBeNull()
  })

  it('reads nothing from a number too big to keep, or brackets nested past reason, without throwing', () => {
    expect(parseTyped('9'.repeat(400))).toBeNull()
    expect(parseTyped(`${'('.repeat(5000)}1${')'.repeat(5000)}`)).toBeNull()
    expect(parseTyped('-'.repeat(5000) + '1')).toBeNull()
  })

  it('reads nothing from an empty field', () => {
    expect(parseTyped('')).toBeNull()
    expect(parseTyped('   ')).toBeNull()
  })
})

describe('fieldEdit', () => {
  /** The values the layers have after an edit, from the values they had. */
  const after = (edit: ReturnType<typeof fieldEdit>, values: number[]) =>
    values.map((now) => ('set' in edit ? edit.set : edit.each(now)))
  /** A percentage field: shown 100 times its value, between 0 and 1. */
  const PERCENT = { scale: 100, min: 0, max: 1 }

  it('sets one value, or every layer’s, to the number typed, in the value as shown, within the limits', () => {
    expect(fieldEdit({ set: 120 })).toEqual({ set: 120 })
    expect(after(fieldEdit({ set: 120 }), [40, 64])).toEqual([120, 120])
    expect(fieldEdit({ set: 40 }, PERCENT)).toEqual({ set: 0.4 })
    expect(fieldEdit({ set: 150 }, PERCENT)).toEqual({ set: 1 })
  })

  it('shifts one value, or each layer’s own, within the limits', () => {
    expect(after(fieldEdit({ shift: 20 }), [100])).toEqual([120])
    expect(after(fieldEdit({ shift: 20 }), [40, 64])).toEqual([60, 84])
    expect(after(fieldEdit({ shift: 10 }, PERCENT), [0.5, 0.95])).toEqual([0.6, 1])
    expect(after(fieldEdit({ shift: -30 }, { min: 0 }), [10, 50])).toEqual([0, 20])
  })

  it('scales one value, or each layer’s own, within the limits', () => {
    expect(after(fieldEdit({ scale: 2 }), [100])).toEqual([200])
    expect(after(fieldEdit({ scale: 0.25 }), [260, 560])).toEqual([65, 140])
    expect(after(fieldEdit({ scale: 2 }, PERCENT), [0.3, 0.8])).toEqual([0.6, 1])
  })
})

describe('fontSizeChange', () => {
  it('sets every text to the size typed, in tenths, between 1 and the largest size', () => {
    expect([40, 64].map(fontSizeChange({ set: 12.34 }))).toEqual([12.3, 12.3])
    expect([40].map(fontSizeChange({ set: 0.5 }))).toEqual([1])
    expect([40].map(fontSizeChange({ set: 9000 }))).toEqual([2000])
  })

  it('shifts and scales each text’s own size, rounded the one way the field shows it', () => {
    expect([40, 64].map(fontSizeChange({ shift: 2 }))).toEqual([42, 66])
    expect([13.3].map(fontSizeChange({ scale: 1.5 }))).toEqual([20])
    expect([13.3, 20].map(fontSizeChange({ scale: 1.5 }))).toEqual([20, 30])
    expect([1.5, 64].map(fontSizeChange({ shift: -2 }))).toEqual([1, 62])
  })
})
