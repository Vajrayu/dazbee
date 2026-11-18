// A drop shadow or glow hidden behind its own layer: a translucent layer doesn't show
// its shadow through itself, unless the shadow is set to show behind it. Measured on the CPU render.
import { describe, expect, it } from 'vitest'

import {
  BLACK,
  draw,
  graphic,
  hash,
  photo,
  pixel,
  shadow,
  slower,
  solid,
  type TestLayer,
  WHITE,
} from './test-shadows.ts'

const frame = { width: 400, height: 400, fills: [solid(WHITE)] }
const box = { x: 100, y: 100, width: 200, height: 200 }
const red = (opacity?: number) => [solid('#FF0000FF', opacity)]
const card = (props: Record<string, unknown>) => graphic({ kind: 'rect' }, { ...box, ...props })

/** Checks each channel of `rgba` is within `within` of `expected`'s; a failure shows the channels that aren't. */
function expectColor(rgba: number[], expected: number[], within = 1) {
  expect(rgba.map((v, i) => (Math.abs(v - (expected[i] ?? 0)) <= within ? expected[i] : v))).toEqual(expected)
}

describe('drawDropShadow', () => {
  it("hides a translucent fill's shadow behind it, at offset 0", () => {
    const r = draw([card({ fills: red(0.5), effects: [shadow(0)] })], frame)
    expectColor(pixel(r, 200, 200), [255, 128, 128, 255])
  })

  it('shows the shadow through the layer when it shows behind, as strong as the layer is opaque', () => {
    const r = draw([card({ fills: red(0.5), effects: [shadow(0, { showBehind: true })] })], frame)
    expectColor(pixel(r, 200, 200), [191, 64, 64, 255])
  })

  it('casts the shadow outside the layer as before at an offset, hidden only under the layer', () => {
    const at = (showBehind: boolean) =>
      draw([card({ fills: red(0.5), effects: [shadow(0, { x: 10, y: 10, blur: 4, showBehind })] })], frame)
    const [hidden, through] = [at(false), at(true)]
    for (const [x, y] of [
      [305, 200],
      [308, 308],
      [200, 306],
    ] as const)
      expect(pixel(hidden, x, y)).toEqual(pixel(through, x, y))
    expectColor(pixel(hidden, 200, 200), [255, 128, 128, 255])
  })

  it('fades the layer and its shadow together at layer opacity 0.5', () => {
    const r = draw([card({ fills: red(), opacity: 0.5, effects: [shadow(0, { x: 20, y: 20 })] })], frame)
    expectColor(pixel(r, 200, 200), [255, 128, 128, 255])
    expectColor(pixel(r, 310, 310), [128, 128, 128, 255])
  })

  it("shows the shadow in a stroke-only shape's empty middle, hidden under its translucent stroke", () => {
    const r = draw(
      [
        card({
          fills: [],
          strokes: [{ paint: solid('#FF0000FF', 0.5), width: 10 }],
          effects: [shadow(0, { x: 40, y: 40 })],
        }),
      ],
      frame,
    )
    // The left stroke's shadow, as strong as the stroke, in the middle; then where it crosses the bottom stroke.
    expectColor(pixel(r, 140, 200), [128, 128, 128, 255])
    expectColor(pixel(r, 140, 300), [255, 128, 128, 255])
  })

  it('hides the shadow behind a blurred layer by its blurred pixels, with no hard edge at its outline', () => {
    const at = (showBehind: boolean) =>
      draw(
        [
          card({
            fills: red(),
            effects: [shadow(0, { x: 40, showBehind }), { type: 'layerBlur', radius: 10 }],
          }),
        ],
        frame,
      )
    const [hidden, through] = [at(false), at(true)]
    // At the outline the blurred red's alpha a is about half, as the red shown over the shadow reads.
    // Hidden as far as a, the shadow under it is 1 − a strong: the red over it, over white.
    const a = (pixel(through, 300, 200)[0] ?? 0) / 255
    expect(a).toBeGreaterThan(0.3)
    expect(a).toBeLessThan(0.7)
    const green = 255 * a * (1 - a)
    expectColor(pixel(hidden, 300, 200), [255 * a * (2 - a), green, green, 255], 2)
    for (let x = 280; x < 320; x++)
      expect(Math.abs((pixel(hidden, x + 1, 200)[1] ?? 0) - (pixel(hidden, x, 200)[1] ?? 0))).toBeLessThanOrEqual(12)
  })

  it('hides the shadow behind a clipping box with a fill by its outline, whatever its children', () => {
    const glass: TestLayer = {
      type: 'box',
      props: { ...box, clip: true, fills: [solid('#FF000080')], effects: [shadow(0, { x: 20, y: 20 })] },
      children: [card({ x: 120, y: 120, width: 40, height: 40, fills: [solid('#0000FFFF')] })],
    }
    const r = draw([glass], frame)
    expectColor(pixel(r, 200, 200), [255, 128, 128, 255])
    // Outside the box, the shadow casts as before, as strong as the half-clear fill.
    expectColor(pixel(r, 310, 310), [128, 128, 128, 255])
  })

  it('hides the shadow behind a clipping box with no fill by its pixels, as a group', () => {
    const empty = (clip: boolean, strokes: unknown[] = []): TestLayer => ({
      type: 'box',
      props: { ...box, clip, fills: [], strokes, effects: [shadow(0, { x: 20, y: 20 })] },
      children: [card({ x: 180, y: 180, width: 40, height: 40, fills: [solid('#0000FFFF')] })],
    })
    // The opaque child's shadow falls in the box's clear middle, as it does without the clip.
    expectColor(pixel(draw([empty(true)], frame), 230, 230), [0, 0, 0, 255])
    expect(pixel(draw([empty(true)], frame), 230, 230)).toEqual(pixel(draw([empty(false)], frame), 230, 230))
    // Under a half-clear outside stroke, the top stroke's shadow is half hidden, as by a group's pixels.
    const stroked = draw([empty(true, [{ paint: solid('#FF000080'), width: 10, align: 'outside' }])], frame)
    expectColor(pixel(stroked, 305, 115), [223, 96, 96, 255], 2)
  })

  it('hides the shadow behind an opaque photo at paint opacity 0.5, and behind a gradient with a clear stop', () => {
    const photoCard = card({
      fills: [{ type: 'image', assetId: 'photo', fit: 'fill', opacity: 0.5 }],
      effects: [shadow(0)],
    })
    const shown = draw([card({ fills: [{ type: 'image', assetId: 'photo', fit: 'fill', opacity: 0.5 }] })], frame, {
      photo,
    })
    expectColor(pixel(draw([photoCard], frame, { photo }), 200, 200), pixel(shown, 200, 200))
    const stops = [
      { offset: 0, color: '#FF0000FF' },
      { offset: 1, color: '#FF000000' },
    ]
    const gradient = { type: 'linear', from: { x: 0, y: 0.5 }, to: { x: 1, y: 0.5 }, stops }
    const r = draw([card({ fills: [gradient], effects: [shadow(0)] })], frame)
    // Half way, the red is half clear and nothing shows under it; near the clear end, white.
    expectColor(pixel(r, 200, 200), [255, 128, 128, 255], 2)
    expectColor(pixel(r, 299, 200), [255, 254, 254, 255], 2)
  })

  it('hides the shadow behind a rotated translucent layer, and casts it past it as before', () => {
    const at = (showBehind: boolean) =>
      draw([card({ fills: red(0.5), rotation: 30, effects: [shadow(0, { x: 30, showBehind })] })], frame)
    const [hidden, through] = [at(false), at(true)]
    expectColor(pixel(hidden, 200, 200), [255, 128, 128, 255])
    expectColor(pixel(through, 200, 200), [191, 64, 64, 255])
    // Past the turned card's right edge, where only the shadow is, as strong as the half-clear fill.
    expect(pixel(hidden, 350, 185)).toEqual(pixel(through, 350, 185))
    expectColor(pixel(hidden, 350, 185), [128, 128, 128, 255])
  })

  it("hides a group's shadow behind it only in part, as far as its pixels are opaque", () => {
    const group: TestLayer = {
      type: 'group',
      props: { ...box, effects: [shadow(0)] },
      children: [card({ fills: red(0.5) })],
    }
    // The half-strong shadow is half hidden: green 96, where shown it is 64 and hidden whole 128.
    expectColor(pixel(draw([group], frame), 200, 200), [223, 96, 96, 255], 2)
  })

  it("hides a group's shadow alike whether another shows behind, where a child multiplies or frosts what is behind", () => {
    const at = (child: TestLayer, showBehind: boolean) => {
      const effects = [shadow(0, { x: 20, y: 20 }), shadow(0, { x: 150, showBehind })]
      return draw([{ type: 'group', props: { ...box, effects }, children: [child] }], frame)
    }
    const multiply = card({ fills: red(0.5), blendMode: 'multiply' })
    const frosted = card({ fills: red(0.5), effects: [{ type: 'backgroundBlur', radius: 10 }] })
    // Under the layer, where only the first shadow falls.
    for (const child of [multiply, frosted])
      for (const [x, y] of [
        [150, 250],
        [200, 150],
      ] as const)
        expect(pixel(at(child, false), x, y)).toEqual(pixel(at(child, true), x, y))
  })

  it('hides a glow behind a translucent pill', () => {
    const pill = graphic(
      { kind: 'rect', cornerRadius: 50 },
      {
        x: 100,
        y: 150,
        width: 200,
        height: 100,
        fills: red(0.5),
        effects: [{ type: 'glow', blur: 10, spread: 0, color: BLACK }],
      },
    )
    expectColor(pixel(draw([pill], frame), 200, 200), [255, 128, 128, 255])
  })

  it('draws the same bytes as before for an opaque layer and an opaque text', () => {
    const effects = [shadow(0, { x: 12, y: 16, blur: 10, color: '#00000099' })]
    const layer = graphic(
      { kind: 'rect', cornerRadius: 30 },
      { ...box, fills: red(), strokes: [{ paint: solid('#2244AAFF'), width: 8, align: 'outside' }], effects },
    )
    const text: TestLayer = {
      type: 'text',
      props: {
        x: 40,
        y: 120,
        width: 320,
        height: 120,
        text: 'Hidden',
        style: {
          fontFamily: 'Noto Sans',
          fontSize: 72,
          fontWeight: 800,
          color: '#D81B60FF',
          outline: { width: 2, color: '#000000FF' },
        },
        effects,
      },
    }
    expect([hash(draw([layer], frame)), hash(draw([text], frame))]).toEqual(['b05904d4f47ac42a', 'd455ce60a9a1b96c'])
  })
})

describe('the cost of hiding', () => {
  it('costs a group, a blurred layer or many stroked cards at most four times showing the shadows behind them', () => {
    const big = { width: 1080, height: 1080, fills: [solid(WHITE)] }
    const effects = (showBehind: boolean) => [
      shadow(0, { x: 8, y: 8, blur: 12, showBehind }),
      shadow(0, { x: 0, y: 20, blur: 30, color: '#3366FF80', showBehind }),
    ]
    const group = (showBehind: boolean) => () => {
      const children = Array.from({ length: 200 }, (_, i) =>
        card({ x: 40 + (i % 20) * 50, y: 40 + Math.floor(i / 20) * 100, width: 40, height: 80, fills: red(0.5) }),
      )
      const props = { x: 40, y: 40, width: 1000, height: 1000, effects: effects(showBehind) }
      draw([{ type: 'group', props, children }], big)
    }
    const blurred = (showBehind: boolean) => () => {
      const props = { x: 140, y: 140, width: 800, height: 800, fills: red() }
      const blur = { type: 'layerBlur', radius: 30 }
      draw([graphic({ kind: 'rect', cornerRadius: 40 }, { ...props, effects: [...effects(showBehind), blur] })], big)
    }
    const cards = (showBehind: boolean) => () => {
      const layers = Array.from({ length: 300 }, (_, i) =>
        card({
          x: 20 + (i % 20) * 52,
          y: 20 + Math.floor(i / 20) * 70,
          width: 44,
          height: 60,
          fills: red(0.5),
          strokes: [{ paint: solid('#2244AAFF', 0.5), width: 4 }],
          effects: effects(showBehind),
        }),
      )
      draw(layers, big)
    }
    const times = [group, blurred, cards].map((layers) => slower(layers(false), layers(true), 3))
    expect(Math.max(...times)).toBeLessThanOrEqual(4)
  }, 300_000)
})
