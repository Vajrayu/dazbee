// The auto layout solver (#46), through scene building, with the stand-in measure of test-layout.ts.
import { describe, expect, it } from 'vitest'

import { box, boxLayer, layout, nestedIn, type Node, PAD, rect, scene, text } from './test-layout.ts'

describe('auto layout (#46)', () => {
  it('runs children along a row or down a column, gap apart inside the paddings', () => {
    const padding = { top: 10, right: 20, bottom: 30, left: 40 }
    const row = scene({
      f: boxLayer('sq', 'a0', { ...box(100, 100, 400, 200), layout: layout({ gap: 12, padding }) }),
      a: rect('f', 'a0', box(0, 0, 50, 20)),
      b: rect('f', 'a1', box(999, 999, 60, 40)),
    })
    expect(row('a')).toEqual(box(140, 110, 50, 20))
    expect(row('b')).toEqual(box(202, 110, 60, 40))
    const column = scene({
      f: boxLayer('sq', 'a0', {
        ...box(100, 100, 400, 200),
        layout: layout({ direction: 'column', gap: 12, padding }),
      }),
      a: rect('f', 'a0', box(0, 0, 50, 20)),
      b: rect('f', 'a1', box(0, 0, 60, 40)),
    })
    expect(column('a')).toEqual(box(140, 110, 50, 20))
    expect(column('b')).toEqual(box(140, 142, 60, 40))
  })

  it('sizes children fixed, hugging their text or filling what is left, and the box hugging them', () => {
    const get = scene({
      f: boxLayer('sq', 'a0', {
        ...box(0, 0, 500, 100),
        layout: layout({ gap: 10, padding: { top: 5, right: 5, bottom: 5, left: 5 } }),
      }),
      fixed: rect('f', 'a0', box(0, 0, 50, 30)),
      label: text('f', 'a1', 'Buy now'),
      grow: rect('f', 'a2', { ...box(0, 0, 10, 10), sizing: { width: 'fill', height: 'fill' } }),
      grow2: rect('f', 'a3', { ...box(0, 0, 10, 10), sizing: { width: 'fill', height: 'fixed' } }),
      btn: boxLayer('sq', 'a1', {
        ...box(0, 200, 10, 10),
        sizing: { width: 'hug', height: 'hug' },
        layout: layout({ padding: { top: 8, right: 16, bottom: 8, left: 16 } }),
      }),
      btnLabel: text('btn', 'a0', 'Shop the sale'),
    })
    expect(get('label')).toEqual(box(65, 5, 70, 20))
    // 490 inside, less 50, 70 and three gaps, shared by the two that fill.
    expect(get('grow')).toEqual(box(145, 5, 170, 90))
    expect(get('grow2')).toEqual(box(325, 5, 170, 10))
    expect(get('btn')).toEqual(box(0, 200, 162, 36))
    expect(get('btnLabel')).toEqual(box(16, 208, 130, 20))
  })

  it("grows a button that hugs its label by as much as the label's words grow, and moves the tile after it along by as much", () => {
    const row = (label: string) =>
      scene({
        bar: boxLayer('sq', 'a0', {
          ...box(100, 100, 880, 200),
          layout: layout({ gap: 24, padding: PAD(24), align: 'center' }),
        }),
        btn: boxLayer('bar', 'a0', {
          ...box(0, 0, 10, 10),
          sizing: { width: 'hug', height: 'hug' },
          layout: layout({ padding: { top: 16, right: 32, bottom: 16, left: 32 } }),
        }),
        label: text('btn', 'a0', label),
        tile: rect('bar', 'a1', box(0, 0, 120, 120)),
      })
    // "Buy" is 30 wide: the button is the label and its padding, centred across the 200 tall bar.
    const short = row('Buy')
    expect(short('btn')).toEqual(box(124, 174, 94, 52))
    expect(short('label')).toEqual(box(156, 190, 30, 20))
    expect(short('tile')).toEqual(box(242, 140, 120, 120))
    // "Buy now" is 40 wider: so is the button, at the same place and height, and the tile moves 40 along.
    const long = row('Buy now')
    expect(long('btn')).toEqual(box(124, 174, 134, 52))
    expect(long('label')).toEqual(box(156, 190, 70, 20))
    expect(long('tile')).toEqual(box(282, 140, 120, 120))
  })

  it('lines children up along the flow and across it', () => {
    const at = (justify: string, align: string) =>
      scene({
        f: boxLayer('sq', 'a0', { ...box(0, 0, 300, 100), layout: layout({ gap: 10, justify, align }) }),
        a: rect('f', 'a0', box(0, 0, 50, 20)),
        b: rect('f', 'a1', box(0, 0, 50, 40)),
      })
    expect([at('center', 'center')('a'), at('center', 'center')('b')]).toEqual([
      box(95, 40, 50, 20),
      box(155, 30, 50, 40),
    ])
    expect([at('end', 'end')('a'), at('end', 'end')('b')]).toEqual([box(190, 80, 50, 20), box(250, 60, 50, 40)])
    expect([at('space-between', 'start')('a'), at('space-between', 'start')('b')]).toEqual([
      box(0, 0, 50, 20),
      box(250, 0, 50, 40),
    ])
  })

  it('takes negative gaps and paddings, so children overlap and spill out', () => {
    const get = scene({
      f: boxLayer('sq', 'a0', {
        ...box(100, 100, 10, 10),
        sizing: { width: 'hug', height: 'hug' },
        layout: layout({ gap: -20, padding: { top: -5, right: 0, bottom: 0, left: -10 } }),
      }),
      a: rect('f', 'a0', box(0, 0, 50, 50)),
      b: rect('f', 'a1', box(0, 0, 50, 50)),
    })
    expect(get('a')).toEqual(box(90, 95, 50, 50))
    expect(get('b')).toEqual(box(120, 95, 50, 50))
    expect(get('f')).toEqual(box(100, 100, 70, 45))
  })

  it("nests: a card hugs a column of a title that wraps at the card's width and a button that hugs its label", () => {
    const get = scene({
      card: boxLayer('sq', 'a0', {
        ...box(100, 100, 200, 10),
        sizing: { width: 'fixed', height: 'hug' },
        layout: layout({ direction: 'column', gap: 12, padding: { top: 20, right: 20, bottom: 20, left: 20 } }),
      }),
      title: text('card', 'a0', 'Fresh roast every morning', {
        boxMode: 'autoHeight',
        sizing: { width: 'fill', height: 'hug' },
      }),
      btn: boxLayer('card', 'a1', {
        ...box(0, 0, 10, 10),
        sizing: { width: 'hug', height: 'hug' },
        layout: layout({ padding: { top: 8, right: 16, bottom: 8, left: 16 } }),
      }),
      label: text('btn', 'a0', 'Order'),
      badge: rect('card', 'a2', { ...box(280, 90, 30, 30), absolute: true }),
    })
    // 160 wide: "Fresh roast every" (170) doesn't fit, so two lines.
    expect(get('title')).toEqual(box(120, 120, 160, 40))
    expect(get('btn')).toEqual(box(120, 172, 82, 36))
    expect(get('label')).toEqual(box(136, 180, 50, 20))
    expect(get('card')).toEqual(box(100, 100, 200, 128))
    // Absolute children stay put.
    expect(get('badge')).toEqual(box(280, 90, 30, 30))
  })

  it('lays out a laid-out box kept where it is put inside another flow, at its own place', () => {
    const get = scene({
      col: boxLayer('sq', 'a0', { ...box(100, 100, 300, 300), layout: layout({ direction: 'column', gap: 10 }) }),
      first: rect('col', 'a0', box(0, 0, 80, 40)),
      kept: boxLayer('col', 'a1', {
        ...box(500, 600, 10, 10),
        absolute: true,
        sizing: { width: 'hug', height: 'hug' },
        layout: layout({ gap: 5, padding: { top: 4, right: 4, bottom: 4, left: 4 } }),
      }),
      one: rect('kept', 'a0', box(80, 80, 20, 20)),
      two: rect('kept', 'a1', box(100, 100, 30, 20)),
    })
    expect(get('kept')).toEqual(box(500, 600, 63, 28))
    expect(get('one')).toEqual(box(504, 604, 20, 20))
    expect(get('two')).toEqual(box(529, 604, 30, 20))
  })

  it('moves what a group holds with it, and leaves boxes without auto layout alone', () => {
    const get = scene({
      f: boxLayer('sq', 'a0', { ...box(0, 0, 500, 100), layout: layout({ gap: 10 }) }),
      g: { type: 'group', parentId: 'f', index: 'a0', name: 'g', props: box(300, 300, 40, 40) } as Node,
      inG: rect('g', 'a0', box(310, 310, 20, 20)),
      plain: boxLayer('sq', 'a1', box(600, 600, 100, 100)),
      inPlain: rect('plain', 'a0', box(650, 650, 10, 10)),
    })
    expect(get('g')).toEqual(box(0, 0, 40, 40))
    expect(get('inG')).toEqual(box(10, 10, 20, 20))
    expect(get('inPlain')).toEqual(box(650, 650, 10, 10))
  })

  it('leaves a turned layer the room of its turned bounds in a row and a column, drawn at its own size in their middle', () => {
    const near = (got: ReturnType<typeof box>, want: ReturnType<typeof box>) =>
      Object.entries(want).forEach(([key, value]) => expect(got[key as keyof typeof want]).toBeCloseTo(value, 6))
    const row = scene({
      f: boxLayer('sq', 'a0', {
        ...box(0, 0, 500, 100),
        sizing: { width: 'fixed', height: 'hug' },
        layout: layout({ gap: 10, padding: { top: 5, right: 5, bottom: 5, left: 5 } }),
      }),
      turned: rect('f', 'a0', { ...box(0, 0, 100, 40), rotation: 90 }),
      after: rect('f', 'a1', box(0, 0, 50, 50)),
    })
    // Turned a quarter, it takes 40 × 100: drawn 100 × 40 about the middle of that.
    near(row('turned'), box(-25, 35, 100, 40))
    near(row('after'), box(55, 5, 50, 50))
    near(row('f'), box(0, 0, 500, 110))

    const column = scene({
      f: boxLayer('sq', 'a0', {
        ...box(0, 0, 10, 10),
        sizing: { width: 'hug', height: 'hug' },
        layout: layout({ direction: 'column', gap: 10 }),
      }),
      turned: rect('f', 'a0', { ...box(0, 0, 120, 60), rotation: 30 }),
      after: rect('f', 'a1', box(0, 0, 50, 50)),
    })
    const wide = 120 * Math.cos(Math.PI / 6) + 60 * 0.5
    const tall = 120 * 0.5 + 60 * Math.cos(Math.PI / 6)
    near(column('turned'), box((wide - 120) / 2, (tall - 60) / 2, 120, 60))
    near(column('after'), box(0, tall + 10, 50, 50))
    near(column('f'), box(0, 0, wide, tall + 60))
  })

  it('fills with a layer turned half way round, whose turned bounds are its own box', () => {
    const get = scene({
      f: boxLayer('sq', 'a0', { ...box(0, 0, 500, 100), layout: layout({}) }),
      a: rect('f', 'a0', { ...box(0, 0, 100, 40), rotation: 180, sizing: { width: 'fill', height: 'fixed' } }),
      b: rect('f', 'a1', { ...box(0, 0, 100, 40), sizing: { width: 'fill', height: 'fixed' } }),
    })
    expect(get('a')).toEqual(box(0, 0, 250, 40))
    expect(get('b')).toEqual(box(250, 0, 250, 40))
  })

  it('stretches a layer that fills across the flow of a box that fits its content to the widest layer beside it that does not fill', () => {
    const get = scene({
      col: boxLayer('sq', 'a0', {
        ...box(0, 0, 10, 10),
        sizing: { width: 'hug', height: 'hug' },
        layout: layout({ direction: 'column', gap: 10, padding: { top: 20, right: 20, bottom: 20, left: 20 } }),
      }),
      title: text('col', 'a0', 'Big summer sale'),
      wide: rect('col', 'a1', { ...box(0, 0, 600, 40), sizing: { width: 'fill', height: 'fixed' } }),
      bar: rect('col', 'a2', box(0, 0, 120, 20)),
    })
    // The title is 150 wide, wider than the bar: the column fits it, and the stored 600 sizes nothing.
    expect(get('wide')).toEqual(box(20, 50, 150, 40))
    expect(get('col')).toEqual(box(0, 0, 190, 140))
  })

  it('keeps the own sizes of layers that all fill across the flow of a box that fits its content', () => {
    const get = scene({
      row: boxLayer('sq', 'a0', {
        ...box(0, 0, 10, 10),
        sizing: { width: 'hug', height: 'hug' },
        layout: layout({ gap: 10 }),
      }),
      a: rect('row', 'a0', { ...box(0, 0, 50, 30), sizing: { width: 'fixed', height: 'fill' } }),
      b: rect('row', 'a1', { ...box(0, 0, 50, 70), sizing: { width: 'fixed', height: 'fill' } }),
    })
    expect(get('a')).toEqual(box(0, 0, 50, 30))
    expect(get('b')).toEqual(box(60, 0, 50, 70))
    expect(get('row')).toEqual(box(0, 0, 110, 70))
  })

  it('keeps those own sizes in a box nested one and two levels deep, as at the top', () => {
    const fillH = { width: 'fixed', height: 'fill' }
    const nodes = {
      row: boxLayer('sq', 'a0', {
        ...box(0, 0, 10, 10),
        sizing: { width: 'hug', height: 'hug' },
        layout: layout({ gap: 10 }),
      }),
      a: rect('row', 'a0', { ...box(0, 0, 50, 30), sizing: fillH }),
      b: rect('row', 'a1', { ...box(0, 0, 50, 70), sizing: fillH }),
    }
    for (const depth of [1, 2]) {
      const get = scene(nestedIn(depth, 'row', nodes))
      expect([get('a'), get('b'), get('row')]).toEqual([box(0, 0, 50, 30), box(60, 0, 50, 70), box(0, 0, 110, 70)])
    }
  })

  it('keeps the own sizes of layers that fill along a side that fits its content, at the top and nested', () => {
    const fillW = { width: 'fill', height: 'fixed' }
    const nodes = {
      row: boxLayer('sq', 'a0', {
        ...box(0, 0, 10, 10),
        sizing: { width: 'hug', height: 'hug' },
        layout: layout({ gap: 10 }),
      }),
      a: rect('row', 'a0', { ...box(0, 0, 50, 30), sizing: fillW }),
      b: rect('row', 'a1', { ...box(0, 0, 80, 20), sizing: fillW }),
    }
    for (const depth of [0, 1, 2]) {
      const get = scene(nestedIn(depth, 'row', nodes))
      expect([get('a'), get('b'), get('row')]).toEqual([box(0, 0, 50, 30), box(60, 0, 80, 20), box(0, 0, 140, 30)])
    }
  })

  it("moves a nested laid-out box's absolute layers with it when an outer flow places it", () => {
    const get = scene({
      col: boxLayer('sq', 'a0', { ...box(100, 100, 300, 300), layout: layout({ direction: 'column', gap: 10 }) }),
      first: rect('col', 'a0', box(0, 0, 80, 40)),
      inner: boxLayer('col', 'a1', { ...box(500, 600, 200, 100), layout: layout({ padding: PAD(10) }) }),
      inFlow: rect('inner', 'a0', box(0, 0, 20, 20)),
      badge: rect('inner', 'a1', { ...box(680, 590, 30, 30), absolute: true }),
    })
    // The column puts the inner box at 100,150, 400 left and 450 up of where it is stored.
    expect(get('inner')).toEqual(box(100, 150, 200, 100))
    expect(get('inFlow')).toEqual(box(110, 160, 20, 20))
    expect(get('badge')).toEqual(box(280, 140, 30, 30))
  })

  describe('a laid-out box that fills one side and fits its content on the other', () => {
    const fillHug = { width: 'fill', height: 'hug' }
    const fills = (parentId: string, width = 100) =>
      boxLayer(parentId, 'a0', { ...box(0, 0, width, 10), sizing: fillHug, layout: layout({ direction: 'column' }) })
    const outer = (direction: string, width = 400, more = {}) =>
      boxLayer('sq', 'a0', {
        ...box(0, 0, width, 10),
        sizing: { width: 'fixed', height: 'hug' },
        layout: layout({ direction, ...more }),
      })
    // 190 wide on one line; two lines at 100 wide.
    const words = (parentId: string) =>
      text(parentId, 'a0', 'aaaa bbbb cccc dddd', { boxMode: 'autoHeight', sizing: fillHug })

    it('fits its height at the width it fills across a column', () => {
      const get = scene({ col: outer('column'), card: fills('col'), words: words('card') })
      expect(get('words')).toEqual(box(0, 0, 400, 20))
      expect(get('card')).toEqual(box(0, 0, 400, 20))
      expect(get('col')).toEqual(box(0, 0, 400, 20))
    })

    it('fits its height at the width it fills along a row', () => {
      const get = scene({ row: outer('row'), card: fills('row'), words: words('card') })
      expect(get('card')).toEqual(box(0, 0, 400, 20))
      expect(get('row')).toEqual(box(0, 0, 400, 20))
    })

    it('fits its height at the width it fills two levels deep', () => {
      const get = scene({ col: outer('column'), mid: fills('col'), card: fills('mid'), words: words('card') })
      expect(get('card')).toEqual(box(0, 0, 400, 20))
      expect(get('mid')).toEqual(box(0, 0, 400, 20))
      expect(get('col')).toEqual(box(0, 0, 400, 20))
    })

    it('fits its height at the width of the grid cell it fills', () => {
      // Four lines at 50 wide; two at the cell's 100.
      const get = scene({ g: outer('grid', 210, { columns: 2, gap: 10 }), card: fills('g', 50), words: words('card') })
      expect(get('card')).toEqual(box(0, 0, 100, 40))
      expect(get('g')).toEqual(box(0, 0, 210, 40))
    })

    describe('in a column that fits its width, beside a layer that fills its height', () => {
      const col = boxLayer('sq', 'a0', {
        ...box(0, 0, 10, 300),
        sizing: { width: 'hug', height: 'fixed' },
        layout: layout({ direction: 'column' }),
      })
      const tall = rect('col', 'a1', { ...box(0, 0, 200, 10), sizing: { width: 'fixed', height: 'fill' } })

      it('fits its height at the width it fills before the height is shared', () => {
        const get = scene({ col, card: fills('col'), words: words('card'), tall })
        expect(get('card')).toEqual(box(0, 0, 200, 20))
        expect(get('tall')).toEqual(box(0, 20, 200, 280))
      })

      it('so does a text in auto height', () => {
        const get = scene({ col, words: words('col'), tall })
        expect(get('words')).toEqual(box(0, 0, 200, 20))
        expect(get('tall')).toEqual(box(0, 20, 200, 280))
      })
    })
  })

  it('keeps the stored size on a side that fits its content while nothing is in its flow', () => {
    const fit = { width: 'hug', height: 'hug' }
    const get = scene({
      empty: boxLayer('sq', 'a0', { ...box(100, 100, 240, 90), sizing: fit, layout: layout({ padding: PAD(10) }) }),
      hiddenOnly: boxLayer('sq', 'a1', {
        ...box(100, 300, 180, 60),
        sizing: fit,
        layout: layout({ direction: 'grid', padding: PAD(10) }),
      }),
      hidden: rect('hiddenOnly', 'a0', { ...box(0, 0, 50, 50), visible: false }),
      badge: rect('hiddenOnly', 'a1', { ...box(0, 0, 50, 50), absolute: true }),
      one: boxLayer('sq', 'a2', { ...box(100, 500, 400, 400), sizing: fit, layout: layout({ padding: PAD(10) }) }),
      a: rect('one', 'a0', box(0, 0, 50, 20)),
    })
    expect(get('empty')).toEqual(box(100, 100, 240, 90))
    expect(get('hiddenOnly')).toEqual(box(100, 300, 180, 60))
    expect(get('one')).toEqual(box(100, 500, 70, 40))
  })
})
