import { describe, expect, it } from 'vitest'

import type { SceneLayer } from '@dazbee/renderer'

import { hitTest, layersAt, type Looks } from './hit-test.ts'
import { boxLayer, layer, rect, RED, shape } from './test-layers.ts'
import { testLooks } from './test-looks.ts'

const looks = testLooks({})

/** The layers under a point, as `id depth` front-most first. */
const listAt = (layers: SceneLayer[], x: number, y: number, pickable?: (layer: SceneLayer) => boolean) =>
  layersAt(layers, { x, y }, looks, { pickable }).map(({ layer: l, depth }) => `${l.id} ${depth}`)

describe('layersAt', () => {
  it('lists every layer that shows under the point, front-most first, each before what it holds, with its depth', () => {
    const inner = layer('inner', 'group', { x: 0, y: 0, width: 100, height: 100 }, [
      rect('deep', 0, 0, 100, 100),
      rect('beside', 300, 0, 50, 50),
    ])
    const outer = layer('outer', 'group', { x: 0, y: 0, width: 400, height: 100 }, [rect('low', 0, 0, 50, 50), inner])
    const layers = [rect('under', 0, 0, 400, 400), outer, rect('far', 300, 300, 50, 50)]
    expect(listAt(layers, 25, 25)).toEqual(['outer 0', 'inner 1', 'deep 2', 'low 1', 'under 0'])
    expect(listAt(layers, 75, 75)).toEqual(['outer 0', 'inner 1', 'deep 2', 'under 0'])
    expect(listAt(layers, 310, 310)).toEqual(['far 0', 'under 0'])
    expect(listAt(layers, 500, 500)).toEqual([])
  })

  it('lists a group or box turned with what it holds by the point as drawn', () => {
    // A 200 × 20 bar in a group turned 90° stands upright about the group's centre (100, 10).
    const turned = layer('g', 'group', { x: 0, y: 0, width: 200, height: 20, rotation: 90 }, [
      rect('bar', 0, 0, 200, 20),
    ])
    expect(listAt([turned], 100, 80)).toEqual(['g 0', 'bar 1'])
    expect(listAt([turned], 180, 10)).toEqual([])
  })

  it('lists a box that shows itself, and leaves out what a clipping box hides past its outline', () => {
    const box = boxLayer('box', true, [rect('inside', 0, 0, 100, 100), rect('past', 150, 150, 200, 200)], {
      fills: [RED],
    })
    expect(listAt([box], 50, 50)).toEqual(['box 0', 'inside 1'])
    expect(listAt([box], 180, 180)).toEqual(['box 0', 'past 1'])
    expect(listAt([box], 300, 300)).toEqual([])
  })

  it('lists a boolean as one layer, not the shapes it combines', () => {
    const combined = layer('b', 'boolean', { x: 0, y: 0, width: 300, height: 100, fills: [RED] }, [
      rect('a', 0, 0, 200, 100),
      rect('c', 100, 0, 200, 100),
    ])
    expect(listAt([rect('under', 0, 0, 300, 300), combined], 150, 50)).toEqual(['b 0', 'under 0'])
  })

  it('never lists a mask, and lists what it masks only where the mask shows', () => {
    const mask = shape('mask', { kind: 'rect' }, { x: 0, y: 0, width: 100, height: 100, mask: 'alpha' })
    const group = layer('masked group', 'group', { x: 0, y: 0, width: 150, height: 150 }, [
      mask,
      rect('masked', 50, 50, 100, 100),
    ])
    const layers = [rect('under', 0, 0, 300, 300), group]
    expect(listAt(layers, 75, 75)).toEqual(['masked group 0', 'masked 1', 'under 0'])
    expect(listAt(layers, 125, 125)).toEqual(['under 0'])
  })

  it('lists a locked layer and what it holds, unless it cannot be picked', () => {
    const locked = layer('locked', 'group', { x: 0, y: 0, width: 100, height: 100 }, [rect('held', 0, 0, 100, 100)])
    const layers = [rect('under', 0, 0, 100, 100), locked]
    expect(listAt(layers, 50, 50)).toEqual(['locked 0', 'held 1', 'under 0'])
    expect(listAt(layers, 50, 50, (l) => l.id !== 'locked')).toEqual(['under 0'])
  })

  it('stops a pick at the deepest layer of the topmost, reading none of the layers behind it', () => {
    const read: string[] = []
    const counting: Looks = {
      ...looks,
      outline: (l) => {
        read.push(l.id)
        return looks.outline(l)
      },
    }
    const behind = Array.from({ length: 50 }, (_, i) => rect(`behind ${i}`, 0, 0, 100, 100))
    const group = layer('group', 'group', { x: 0, y: 0, width: 100, height: 100 }, [rect('top', 0, 0, 100, 100)])
    expect(hitTest([...behind, group], { x: 50, y: 50 }, counting)?.id).toBe('top')
    expect(read.filter((id) => id.startsWith('behind'))).toEqual([])
  })
})
