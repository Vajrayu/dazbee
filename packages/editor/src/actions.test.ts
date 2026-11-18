import { describe, expect, it } from 'vitest'

import type { Design } from '@dazbee/schema'

import { cropItemOf } from './actions.ts'
import { boundsOf, centreOf } from './layers/transform.ts'
import { goInAction } from './reach.ts'
import { idsOf, pairsIn } from './selection.ts'
import { SHORTCUTS, type StageAction } from './shortcuts.ts'
import { APART, FLOW, harness, HIDDEN_PATHS, PHOTOS, TURNED } from './test-actions.ts'

describe('editorActions', () => {
  describe('perform', () => {
    it('zooms and switches tools without a selection, and says it did', () => {
      const { actions, log } = harness()
      expect(actions.perform('zoomToFit')).toBe(true)
      expect(actions.perform('zoomTo100')).toBe(true)
      expect(actions.perform('zoomIn')).toBe(true)
      expect(actions.perform('toggleRulers')).toBe(true)
      expect(actions.perform('toolPen')).toBe(true)
      expect(actions.perform('toolBox')).toBe(true)
      expect(log).toEqual([
        'fitAll',
        'zoomTo 1',
        'zoomIn',
        'toggleRulers',
        'overlay',
        'viewChanged',
        'tool pen',
        'tool box',
      ])
    })

    it('leaves undo and redo to the editor, which ends what is open first', () => {
      const { actions, session, selection, frame, at } = harness()
      selection.select(['a'], frame.id)
      actions.perform('nudgeRight')
      expect(actions.perform('undo')).toBe(false)
      expect(at('a')).toEqual({ x: 101, y: 100 })
      expect(session.canUndo()).toBe(true)
    })

    it('does nothing to the layers without a selection', () => {
      const { actions, session } = harness()
      expect(actions.perform('delete')).toBe(false)
      expect(actions.perform('nudgeRight')).toBe(false)
      expect(actions.perform('alignLeft')).toBe(false)
      expect(actions.perform('duplicate')).toBe(false)
      expect(session.canUndo()).toBe(false)
    })

    it('goes back to Select with Escape in any other tool, the Hand too, keeping the selection, and the next Escape deselects', () => {
      const others = SHORTCUTS.map(({ action }) => action).filter(
        (a): a is Extract<StageAction, `tool${string}`> => a.startsWith('tool') && a !== 'toolSelect',
      )
      expect(others).toContain('toolHand')
      for (const action of others) {
        const { actions, selection, frame, log } = harness()
        selection.select(['a'], frame.id)
        actions.perform(action)
        log.length = 0
        expect(actions.perform('deselect')).toBe(true)
        expect(log, action).toEqual(['tool select'])
        expect(idsOf(selection.current())).toEqual(['a'])
        actions.perform('deselect')
        expect(selection.current()).toBeNull()
      }
    })

    it('ends the pen path with Enter or Escape', () => {
      const { actions, log } = harness(true)
      expect(actions.perform('deselect')).toBe(true)
      expect(log).toEqual(['pen finish'])
      expect(actions.perform('goIn')).toBe(true)
      expect(log).toEqual(['pen finish', 'pen finish'])
    })

    it('goes into a selected box with Enter and out again with Shift+Enter, as the layers panel selects', () => {
      const { actions, selection, frame } = harness()
      selection.select(['row'], frame.id)
      expect(actions.perform('goIn')).toBe(true)
      expect(idsOf(selection.current())).toEqual(['inRow'])
      expect(selection.entered()).toBe('row')
      expect(actions.perform('goOut')).toBe(true)
      expect(idsOf(selection.current())).toEqual(['row'])
      expect(selection.entered()).toBeNull()
    })

    it('steps to the layer beside the selection with Tab and Shift+Tab, and leaves Tab alone with nothing selected', () => {
      const { actions, selection, frame } = harness()
      expect(actions.perform('nextLayer')).toBe(false)
      selection.select(['b'], frame.id)
      expect(actions.perform('nextLayer')).toBe(true)
      expect(idsOf(selection.current())).toEqual(['a'])
      expect(actions.perform('previousLayer')).toBe(true)
      expect(idsOf(selection.current())).toEqual(['b'])
    })

    it('crops no photo and opens no path with Enter while it is hidden or locked in place, the Crop item still cropping', () => {
      const { actions, selection, frame, log } = harness(false, HIDDEN_PATHS)
      for (const id of ['hiddenPhoto', 'lockedPhoto', 'hiddenPath', 'lockedPath']) {
        selection.select([id], frame.id)
        expect(actions.perform('goIn'), id).toBe(false)
        expect(selection.pathEditing(), id).toBeNull()
      }
      expect(log.filter((line) => line.startsWith('crop'))).toEqual([])
      selection.select(['hiddenPhoto'], frame.id)
      actions.perform('editPoints')
      expect(log.filter((line) => line.startsWith('crop'))).toEqual(['crop hiddenPhoto'])
    })

    it('does with Enter what goInAction says: the crop item’s action on one photo holding no layers or one path, else going in, typing or nothing', () => {
      const { actions, session, selection, frame, log } = harness(false, PHOTOS)
      /** What Enter does to the layers `ids` selected: the action it names, whether it acted, the crops and typing it asked for, the path opened and the selection after. */
      const enter = (ids: string[]) => {
        selection.editPath(null)
        selection.select(ids, frame.id)
        log.length = 0
        const done = actions.perform('goIn')
        const asked = log.filter((line) => line.startsWith('crop') || line.startsWith('type'))
        const points = selection.pathEditing()?.id ?? null
        return { named: goInAction(session.design(), ids), done, asked, points, selected: idsOf(selection.current()) }
      }
      expect(enter(['photo'])).toMatchObject({ named: 'editPoints', asked: ['crop photo'] })
      expect(enter(['zig'])).toMatchObject({ named: 'editPoints', done: true, points: 'zig' })
      expect(enter(['framed'])).toEqual({ named: null, done: true, asked: [], points: null, selected: ['inFramed'] })
      expect(enter(['group'])).toEqual({ named: null, done: true, asked: [], points: null, selected: ['inGroup'] })
      expect(enter(['words'])).toMatchObject({ named: null, done: true, asked: ['type words'] })
      for (const ids of [['inFramed'], ['hiddenPhoto'], ['lockedPhoto'], ['styledPhoto'], ['photo', 'photo2']])
        expect(enter(ids), ids.join()).toEqual({ named: null, done: false, asked: [], points: null, selected: ids })
    })

    it('leaves Enter on a layer with nothing to go into, crop or edit to the page', () => {
      const { actions, selection, frame } = harness()
      selection.select(['a'], frame.id)
      expect(actions.perform('goIn')).toBe(false)
      expect(idsOf(selection.current())).toEqual(['a'])
    })

    it('deletes the selected layers as one undo step, letting the selection go', () => {
      const { actions, session, selection, frame } = harness()
      selection.select(['a', 'b'], frame.id)
      expect(actions.perform('delete')).toBe(true)
      expect(session.design().nodes.a).toBeUndefined()
      expect(session.design().nodes.b).toBeUndefined()
      expect(selection.current()).toBeNull()
      session.undo()
      expect(session.design().nodes.a).toBeDefined()
      expect(session.design().nodes.b).toBeDefined()
    })

    it('groups the selected layers and selects the group', () => {
      const { actions, session, selection, frame } = harness()
      selection.select(['a', 'b'], frame.id)
      actions.perform('group')
      const [group] = idsOf(selection.current())
      expect(session.design().nodes[group ?? '']?.type).toBe('group')
      expect(session.design().nodes.a?.parentId).toBe(group)
    })

    it('says layers in different boxes or groups are apart, and no wrap changes them', () => {
      const { actions, session, selection, frame, log } = harness()
      session.run('node.group', { ids: ['b'], id: 'g' })
      const before = session.design()
      for (const action of ['group', 'boxSelection', 'autoLayout', 'booleanUnion', 'mask'] as const) {
        const other = action === 'mask' ? 'b' : 'inRow'
        selection.select(['a', other], frame.id)
        actions.perform(action)
        expect(log.splice(0)).toContain('refused apart')
        expect(session.design().nodes).toEqual(before.nodes)
        expect(idsOf(selection.current())).toEqual(['a', other])
      }
    })

    it("names a new group, box and auto layout box in the app's words", () => {
      const { actions, session, selection, frame } = harness()
      selection.select(['a'], frame.id)
      actions.perform('group')
      const [group] = idsOf(selection.current())
      expect(session.design().nodes[group ?? '']?.name).toBe('Groupe')
      selection.select(['b'], frame.id)
      actions.perform('boxSelection')
      const [box] = idsOf(selection.current())
      expect(session.design().nodes[box ?? '']?.name).toBe('Boîte')
      selection.select(['c'], frame.id)
      actions.perform('autoLayout')
      const [laidOut] = idsOf(selection.current())
      expect(session.design().nodes[laidOut ?? '']?.name).toBe('Boîte')
    })

    it('ungroups a box, what its auto layout placed staying where it is drawn, and selects what it held', () => {
      const { actions, session, selection, frame, at } = harness()
      selection.select(['row'], frame.id)
      expect(actions.perform('ungroup')).toBe(true)
      expect(session.design().nodes.row).toBeUndefined()
      expect(session.design().nodes.inRow?.parentId).toBe('sq')
      expect(at('inRow')).toEqual({ x: 100, y: 500 })
      expect(idsOf(selection.current())).toEqual(['inRow'])
      session.undo()
      expect(session.design().nodes.inRow?.parentId).toBe('row')
    })

    it('leaves a box in a flow whole when the flow would place what it holds elsewhere, saying nothing', () => {
      const { actions, session, selection, frame, log, drawn } = harness(false, FLOW)
      const before = drawn()
      expect(before.inHug).toMatchObject({ x: 490, y: 850, width: 60, height: 60 })
      expect(before.filling).toMatchObject({ x: 200, y: 820, width: 240, height: 120 })
      selection.select(['hugging'], frame.id)
      expect(actions.perform('ungroup')).toBe(true)
      expect(drawn()).toEqual(before)
      expect(session.design().nodes.hugging).toBeDefined()
      expect(log).not.toContain('placedByLayout')
      expect(session.canUndo()).toBe(false)
      expect(idsOf(selection.current())).toEqual(['hugging'])
    })

    it('ungroups a group in a flow when what it held takes its place there, nothing moving', () => {
      const { actions, session, selection, frame, log, drawn } = harness(false, FLOW)
      const before = drawn()
      selection.select(['fixed', 'filling'], frame.id)
      actions.perform('group')
      const [group = ''] = idsOf(selection.current())
      expect(drawn()).toMatchObject(before)
      expect(actions.perform('ungroup')).toBe(true)
      expect(session.design().nodes[group]).toBeUndefined()
      expect(session.design().nodes.filling?.parentId).toBe('flow')
      expect(drawn()).toEqual(before)
      expect(log).not.toContain('placedByLayout')
    })

    it('ungroups what can come apart in a mixed selection and leaves the rest, with no notice', () => {
      const { actions, session, selection, frame, log } = harness(false, FLOW)
      // A box in the flow that comes apart, one whose auto layout would move what it holds, and a plain layer.
      selection.select(['row', 'hugging', 'fixed'], frame.id)
      expect(actions.perform('ungroup')).toBe(true)
      expect(session.design().nodes.row).toBeUndefined()
      expect(session.design().nodes.hugging?.type).toBe('box')
      expect(idsOf(selection.current())).toEqual(expect.arrayContaining(['hugging', 'fixed']))
      expect(log).not.toContain('placedByLayout')
    })

    it('aligns the selected layers to the left one, as one undo step', () => {
      const { actions, session, selection, frame, at } = harness()
      selection.select(['a', 'b'], frame.id)
      actions.perform('alignLeft')
      expect(at('a')).toEqual({ x: 100, y: 100 })
      expect(at('b')).toEqual({ x: 100, y: 300 })
      actions.perform('alignBottom')
      expect(at('a')).toEqual({ x: 100, y: 300 })
      session.undo()
      expect(at('a')).toEqual({ x: 100, y: 100 })
      session.undo()
      expect(at('b')).toEqual({ x: 250, y: 300 })
    })

    it('aligns one layer to its frame', () => {
      const { actions, selection, frame, at } = harness()
      selection.select(['a'], frame.id)
      actions.perform('alignRight')
      expect(at('a')).toEqual({ x: 980, y: 100 })
    })

    it("lines up a turned layer's turned box as drawn with its frame, keeping its turn, as one undo step", () => {
      const { actions, session, selection, boxes, frame, at } = harness(false, TURNED)
      selection.select(['tilt'], frame.id)
      actions.perform('alignLeft')
      const drawn = boxes.drawnBoxOf(frame, 'tilt')
      if (!drawn) throw new Error('no layer')
      expect(drawn.rotation).toBe(30)
      expect(boundsOf([drawn]).x).toBeCloseTo(0, 0)
      session.undo()
      expect(at('tilt')).toEqual({ x: 640, y: 300 })
    })

    it('spaces the selected layers evenly between the outer ones', () => {
      const { actions, selection, frame, at } = harness()
      selection.select(['a', 'b', 'c'], frame.id)
      actions.perform('distributeHorizontal')
      expect(at('a')).toEqual({ x: 100, y: 100 })
      expect(at('b')).toEqual({ x: 400, y: 300 })
      expect(at('c')).toEqual({ x: 700, y: 120 })
    })

    it('says auto layout places the layers in a flow, and aligns the rest', () => {
      const { actions, selection, frame, at, log } = harness()
      selection.select(['b', 'c', 'inRow'], frame.id)
      actions.perform('alignTop')
      expect(log).toContain('placedByLayout')
      expect(at('b')).toEqual({ x: 250, y: 120 })
      expect(at('c')).toEqual({ x: 700, y: 120 })
      expect(at('inRow')).toEqual({ x: 0, y: 0 })
    })

    it('nudges by a pixel, or ten with Shift, each press one undo step', () => {
      const { actions, session, selection, frame, at } = harness()
      selection.select(['a'], frame.id)
      actions.perform('nudgeRight')
      actions.perform('nudgeDownFar')
      expect(at('a')).toEqual({ x: 101, y: 110 })
      session.undo()
      expect(at('a')).toEqual({ x: 101, y: 100 })
    })

    it('nudges each selected layer along the frame as drawn, one inside a turned group as the others', () => {
      const { actions, selection, boxes, frame } = harness(false, TURNED)
      /** Where a layer's centre is drawn in the square, rounded. */
      const centre = (id: string) => {
        const { x, y } = centreOf(boxes.drawnBoxOf(frame, id) ?? { x: NaN, y: NaN, width: 0, height: 0, rotation: 0 })
        return { x: Math.round(x), y: Math.round(y) }
      }
      selection.select(['a', 'inTurned'], frame.id)
      const was = [centre('a'), centre('inTurned')]
      actions.perform('nudgeRightFar')
      expect([centre('a'), centre('inTurned')]).toEqual(was.map(({ x, y }) => ({ x: x + 10, y })))
    })

    it('nudges a layer in a flow along it, which says why it can go no further', () => {
      const { actions, selection, frame, log } = harness()
      selection.select(['inRow'], frame.id)
      actions.perform('nudgeRight')
      expect(log).toContain('flowEnd')
    })

    it("selects every top-level layer that can be picked of the selection's frame, else of the frame last selected in on the page, else of the frame nearest the middle of the view", () => {
      const { actions, selection, frame, wide } = harness()
      actions.perform('selectAll')
      expect(selection.current()).toEqual(pairsIn(wide.id, ['wide-a']))
      selection.select(['a'], frame.id)
      selection.select([], frame.id)
      actions.perform('selectAll')
      expect(selection.current()).toEqual(pairsIn(frame.id, ['a', 'b', 'c', 'row']))
      selection.select(['wide-a'], wide.id)
      actions.perform('selectAll')
      expect(selection.current()).toEqual(pairsIn(wide.id, ['wide-a']))
    })

    it('locks the selected layers against every change, deleting too, then unlocks them whole when every one is locked', () => {
      const { actions, session, selection, frame } = harness()
      selection.select(['a'], frame.id)
      actions.perform('lock')
      expect(session.design().nodes.a?.lock).toEqual({
        move: true,
        resize: true,
        content: true,
        style: true,
        delete: true,
      })
      actions.perform('delete')
      expect(session.design().nodes.a).toBeDefined()
      actions.perform('lock')
      expect(session.design().nodes.a?.lock).toBeUndefined()
    })

    it('orders a layer to the front and locks it with their keys in its frame alone, its linked copy and an unlinked frame as they were, one undo putting it back', () => {
      /** What each key's action makes of 'a', in the square. */
      const asked = {
        bringToFront: (nodes: Design['nodes']) =>
          expect(
            Object.entries(nodes)
              .filter(([, node]) => node.parentId === 'sq')
              .sort(([, x], [, y]) => (x.index < y.index ? -1 : 1))
              .map(([id]) => id)
              .at(-1),
          ).toBe('a'),
        lock: (nodes: Design['nodes']) =>
          expect(nodes.a?.lock).toEqual({ move: true, resize: true, content: true, style: true, delete: true }),
      }
      for (const action of ['bringToFront', 'lock'] as const) {
        const { actions, session, selection, frame } = harness(false, APART)
        const before = JSON.parse(JSON.stringify(session.design())) as Design
        /** The frames other than the square and the layers in them. */
        const elsewhere = (design: Design) => ({
          frames: [design.frames.wide, design.frames.apart],
          layers: Object.entries(design.nodes).filter(([, node]) => node.parentId !== 'sq' && node.parentId !== 'row'),
        })
        selection.select(['a'], frame.id)
        expect(actions.perform(action), action).toBe(true)
        asked[action](session.design().nodes)
        expect(elsewhere(session.design()), action).toEqual(elsewhere(before))
        session.undo()
        expect(session.design(), action).toEqual(before)
      }
    })

    it('hides the selected layers, keeping them selected, their copies in the other frame left as they are; again shows them', () => {
      const { actions, session, selection, frame } = harness()
      const copy = session.design().nodes['wide-a']
      selection.select(['a'], frame.id)
      actions.perform('hide')
      expect(session.design().nodes.a?.props.visible).toBe(false)
      expect(session.design().nodes['wide-a']).toEqual(copy)
      expect(idsOf(selection.current())).toEqual(['a'])
      actions.perform('hide')
      expect(session.design().nodes.a?.props.visible).toBe(true)
    })

    it('lets the picked frame go with Esc, and deletes it with Delete, its layers too and their linked copies left, as one undo step the page hears of', () => {
      const { actions, frameActions, session, selection, frame, log } = harness()
      frameActions.onFrameDelete((name) => log.push(`deleted ${name}`))
      selection.pickFrame(frame.id)
      expect(actions.perform('deselect')).toBe(true)
      expect(selection.pickedFrame()).toBeNull()
      selection.pickFrame(frame.id)
      expect(actions.perform('delete')).toBe(true)
      expect(session.design().frames[frame.id]).toBeUndefined()
      expect(session.design().nodes.a).toBeUndefined()
      expect(session.design().nodes['wide-a']).toBeDefined()
      expect(selection.pickedFrame()).toBeNull()
      expect(log).toEqual(['overlay', 'deleted Square', 'overlay'])
      session.undo()
      expect(session.design().frames[frame.id]).toBeDefined()
      expect(session.design().nodes.a).toBeDefined()
      expect(session.canUndo()).toBe(false)
    })

    it('duplicates the picked frame with its layers as linked copies, picking the copy and showing it, as one undo step', () => {
      const { actions, session, selection, frame, log } = harness()
      selection.pickFrame(frame.id)
      expect(actions.perform('duplicate')).toBe(true)
      const copy = selection.pickedFrame() ?? ''
      expect(copy).not.toBe(frame.id)
      const made = session.design().frames[copy]
      expect(made).toMatchObject({ name: 'Square', width: 1080, height: 1080 })
      expect(log).toEqual([
        `showWhole ${JSON.stringify({ x: made?.x, y: made?.y, width: 1080, height: 1080 })}`,
        'overlay',
      ])
      const links = Object.values(session.design().nodes)
        .filter((node) => node.parentId === copy)
        .map((node) => node.link)
      expect(links.sort()).toEqual(['a', 'b', 'c', 'pin', 'row'])
      session.undo()
      expect(session.design().frames[copy]).toBeUndefined()
      expect(session.canUndo()).toBe(false)
    })

    it('moves the picked frame by a pixel, or ten with Shift, each press one undo step', () => {
      const { actions, session, selection, wide } = harness()
      selection.pickFrame(wide.id)
      actions.perform('nudgeRight')
      actions.perform('nudgeDownFar')
      actions.perform('nudgeLeftFar')
      actions.perform('nudgeUp')
      expect(session.design().frames[wide.id]).toMatchObject({ x: 1271, y: 9 })
      expect(session.design().nodes['wide-a']?.props).toMatchObject({ x: 100, y: 100 })
      session.undo()
      expect(session.design().frames[wide.id]).toMatchObject({ x: 1271, y: 10 })
    })

    it("leaves the picked frame and its layers be under the layers' other keys", () => {
      const { actions, session, selection, frame } = harness()
      selection.pickFrame(frame.id)
      for (const action of ['group', 'alignLeft', 'lock', 'hide', 'mask', 'bringToFront'] as const)
        expect(actions.perform(action)).toBe(false)
      expect(session.canUndo()).toBe(false)
      expect(selection.pickedFrame()).toBe(frame.id)
    })

    it('selects every layer that can be picked of the picked frame', () => {
      const { actions, selection, frame } = harness()
      selection.pickFrame(frame.id)
      actions.perform('selectAll')
      expect(selection.current()).toEqual(pairsIn(frame.id, ['a', 'b', 'c', 'row']))
      expect(selection.pickedFrame()).toBeNull()
    })

    it('tells that what is shown changed after a change to the layers', () => {
      const { actions, selection, frame, log } = harness()
      selection.select(['a'], frame.id)
      actions.perform('nudgeLeft')
      expect(log).toEqual(['overlay'])
    })
  })

  describe('fitSelection', () => {
    it("fits the box around the selection, else the picked frame, else the shown page's frames", () => {
      const { actions, selection, frame, wide, log } = harness()
      actions.fitSelection()
      selection.select(['a', 'b'], frame.id)
      actions.fitSelection()
      selection.pickFrame(wide.id)
      actions.fitSelection()
      expect(log).toEqual([
        'fitAll',
        `fitArea ${JSON.stringify({ x: frame.x + 100, y: frame.y + 100, width: 250, height: 300 })}`,
        `fitArea ${JSON.stringify({ x: 1280, y: 0, width: 1200, height: 628 })}`,
      ])
    })
  })
})

describe('cropItemOf', () => {
  const design = PHOTOS as unknown as Design

  it('acts on one layer, also hidden or locked in place, saying whether it is a path', () => {
    expect(cropItemOf(design, ['photo'])).toEqual({ id: 'photo', path: false })
    expect(cropItemOf(design, ['hiddenPhoto'])).toEqual({ id: 'hiddenPhoto', path: false })
    expect(cropItemOf(design, ['lockedPhoto'])).toEqual({ id: 'lockedPhoto', path: false })
    expect(cropItemOf(design, ['zig'])).toEqual({ id: 'zig', path: true })
  })

  it('acts on nothing for several layers, one whose style is locked, or none', () => {
    expect(cropItemOf(design, ['photo', 'photo2'])).toBeNull()
    expect(cropItemOf(design, ['styledPhoto'])).toBeNull()
    expect(cropItemOf(design, [])).toBeNull()
  })

  it('acts on nothing in a tab that may only view, a photo or a path alike', () => {
    expect(cropItemOf(design, ['photo'], { readOnly: true })).toBeNull()
    expect(cropItemOf(design, ['zig'], { readOnly: true })).toBeNull()
    expect(cropItemOf(design, ['zig'], { readOnly: false })).toEqual({ id: 'zig', path: true })
  })
})
