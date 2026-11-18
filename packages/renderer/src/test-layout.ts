// Fixtures for the auto layout tests: designs of one square frame, laid out with text measured by a
// stand-in: each character 10 wide, lines 20 tall, words wrapped at the width given.
import { type DesignInput, parseDesign } from '@dazbee/schema'

import type { MeasureText } from './layout.ts'
import { render, type SceneLayer } from './scene.ts'

export const measure: MeasureText = (props, width) => {
  const natural = Math.max(...props.text.split('\n').map((l) => l.length * 10))
  if (width === null) return { width: natural, height: 20 * props.text.split('\n').length }
  let lines = 0
  for (const paragraph of props.text.split('\n')) {
    let line = 0
    lines++
    for (const word of paragraph.split(' ')) {
      const add = (line > 0 ? 1 : 0) * 10 + word.length * 10
      if (line > 0 && line + add > width) {
        lines++
        line = word.length * 10
      } else {
        line += add
      }
    }
  }
  return { width, height: 20 * lines }
}

export type Node = DesignInput['nodes'][string]
export const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height })
export const rect = (parentId: string, index: string, props: Record<string, unknown>): Node =>
  ({
    type: 'graphic',
    parentId,
    index,
    name: index,
    props: { ...box(0, 0, 10, 10), shape: { kind: 'rect' }, ...props },
  }) as Node
export const text = (parentId: string, index: string, value: string, props: Record<string, unknown> = {}): Node =>
  ({
    type: 'text',
    parentId,
    index,
    name: index,
    props: {
      ...box(0, 0, 10, 10),
      text: value,
      style: { fontFamily: 'Noto Sans', fontSize: 16, color: '#000000FF' },
      boxMode: 'autoWidth',
      ...props,
    },
  }) as Node
export const boxLayer = (parentId: string, index: string, props: Record<string, unknown>): Node =>
  ({ type: 'box', parentId, index, name: index, props: { ...box(0, 0, 100, 100), ...props } }) as Node

/** Every layer of the square frame as laid out, by id. */
export function laidOut(nodes: Record<string, Node>) {
  const result = parseDesign({
    meta: { designId: 'd', name: 'Layout' },
    pages: { p1: { name: 'Page 1', order: 'a0' } },
    frames: { sq: { pageId: 'p1', name: 'Square', width: 1080, height: 1080, x: 0, y: 0, order: 'a0' } },
    // In one frame, each layer's link is its own id.
    nodes: Object.fromEntries(Object.entries(nodes).map(([id, node]) => [id, { ...node, link: id }])),
  })
  if (!result.success) throw new Error(result.errors.join('\n'))
  const all = new Map<string, SceneLayer>()
  const walk = (layers: SceneLayer[]) =>
    layers.forEach((l) => {
      all.set(l.id, l)
      walk(l.children)
    })
  walk(render(result.design, 'sq', undefined, measure).layers)
  return all
}

export function scene(nodes: Record<string, Node>) {
  const all = laidOut(nodes)
  return (id: string) => {
    const l = all.get(id)
    if (!l) throw new Error(`no ${id}`)
    return box(l.props.x, l.props.y, l.props.width, l.props.height)
  }
}

export const layout = (props: Record<string, unknown>) => ({ direction: 'row', ...props })
export const PAD = (n: number) => ({ top: n, right: n, bottom: n, left: n })

/** `nodes` with the layer `id` put `depth` boxes deep, each a row at 0, 0 that fits what it holds. */
export function nestedIn(depth: number, id: string, nodes: Record<string, Node>): Record<string, Node> {
  const out = { ...nodes }
  let inner = id
  for (let k = 1; k <= depth; k++) {
    const wrap = `wrap${k}`
    out[inner] = { ...out[inner], parentId: wrap } as Node
    out[wrap] = boxLayer('sq', 'a0', {
      ...box(0, 0, 10, 10),
      sizing: { width: 'hug', height: 'hug' },
      layout: layout({}),
    })
    inner = wrap
  }
  return out
}
