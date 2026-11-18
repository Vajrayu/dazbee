// The selection following a picked layer into the frame that holds it now, as a drop onto another
// frame, its undo or another tab's move takes it there.
import { describe, expect, it } from 'vitest'

import type { Design } from '@dazbee/schema'

import { pairsIn } from './selection.ts'
import { frame, graphic, harness } from './test-selection.ts'

const pairs = (frameId: string, ...ids: string[]) => pairsIn(frameId, ids)

describe('editorSelection keep', () => {
  it('ends a path edit once its layer went into another frame, the layer still picked there', () => {
    const { selection, world } = harness()
    selection.select(['path'], 'p1-f1')
    selection.editPath({ id: 'path', frameId: 'p1-f1' })
    world.design = {
      ...world.design,
      nodes: { ...world.design.nodes, path: graphic('path', 'p1-f2') },
    } as unknown as Design
    selection.keep()
    expect(selection.current()).toEqual(pairs('p1-f2', 'path'))
    expect(selection.pathEditing()).toBeNull()
  })

  it('leaves the group gone into once the layer picked in it went into another frame, remembering that frame', () => {
    const { selection, world } = harness()
    selection.enter('group')
    selection.select(['child'], 'p1-f1')
    world.design = {
      ...world.design,
      nodes: { ...world.design.nodes, child: graphic('rect', 'p1-f2') },
    } as unknown as Design
    selection.keep()
    expect(selection.current()).toEqual(pairs('p1-f2', 'child'))
    expect(selection.entered()).toBeNull()
    expect(selection.lastFrameOn('p1')).toBe('p1-f2')
  })

  it('ends a crop when its layer is no longer selected, or it went into another frame', () => {
    const { selection, world } = harness()
    selection.select(['rect'], 'p1-f1')
    selection.crop({ id: 'rect', frameId: 'p1-f1' })
    selection.keep()
    expect(selection.cropping()).not.toBeNull()
    // The layer went into the other frame: it is picked there, and the crop of it here ends.
    world.design = {
      ...world.design,
      nodes: { ...world.design.nodes, rect: graphic('rect', 'p1-f2') },
    } as unknown as Design
    selection.keep()
    expect(selection.current()).toEqual(pairs('p1-f2', 'rect'))
    expect(selection.cropping()).toBeNull()

    selection.crop({ id: 'rect', frameId: 'p1-f2' })
    selection.selectKeepingModes(pairs('p1-f2', 'dot'))
    selection.keep()
    expect(selection.cropping()).toBeNull()
  })

  it('keeps a picked layer that went into another frame picked, in the frame that holds it now', () => {
    const { selection, world } = harness()
    selection.selectAcross([...pairs('p1-f1', 'rect', 'path'), ...pairs('p1-f2', 'dot')])
    world.design = {
      ...world.design,
      nodes: { ...world.design.nodes, rect: graphic('rect', 'p1-f2') },
    } as unknown as Design
    selection.keep()
    expect(selection.current()).toEqual([
      ...pairs('p1-f2', 'rect'),
      ...pairs('p1-f1', 'path'),
      ...pairs('p1-f2', 'dot'),
    ])
    // Moved to a frame of another page, which isn't shown, it is let go.
    world.frames = [frame('p1', 'f1'), frame('p1', 'f2')]
    world.design = {
      ...world.design,
      nodes: { ...world.design.nodes, path: graphic('path', 'p2-f1') },
    } as unknown as Design
    selection.keep()
    expect(selection.current()).toEqual([...pairs('p1-f2', 'rect'), ...pairs('p1-f2', 'dot')])
  })
})
