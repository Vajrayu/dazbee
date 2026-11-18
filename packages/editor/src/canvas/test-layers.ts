// Scene layers for tests, as the renderer gives them: shapes, photos, text and boxes, their props
// parsed so they take their defaults.
import type { SceneLayer } from '@dazbee/renderer'
import { LAYER_PROPS, type LayerType } from '@dazbee/schema'

export const RED = { type: 'solid', color: '#FF0000FF' } as const

/** A scene layer, its props parsed so they take their defaults. */
export const layer = (id: string, type: LayerType, props: Record<string, unknown>, children: SceneLayer[] = []) =>
  ({ id, type, props: LAYER_PROPS[type].parse(props), children }) as SceneLayer
export const shape = (
  id: string,
  kind: Record<string, unknown>,
  box: Record<string, unknown>,
  fills: unknown[] = [RED],
) => layer(id, 'graphic', { ...box, shape: kind, fills })
export const rect = (id: string, x: number, y: number, width: number, height: number, rotation = 0) =>
  shape(id, { kind: 'rect' }, { x, y, width, height, rotation })
export const photo = (id: string, assetId: string, box: Record<string, unknown>, fill: Record<string, unknown> = {}) =>
  shape(id, { kind: 'rect' }, box, [{ type: 'image', assetId, ...fill }])
export const text = (id: string, value: string, box: Record<string, unknown>, more: Record<string, unknown> = {}) =>
  layer(id, 'text', {
    ...box,
    text: value,
    boxMode: 'fixed',
    style: { fontFamily: 'Noto Sans', fontSize: 40, color: '#000000FF' },
    ...more,
  })
export const boxLayer = (id: string, clip: boolean, children: SceneLayer[], more: Record<string, unknown> = {}) =>
  layer(id, 'box', { x: 0, y: 0, width: 200, height: 200, clip, ...more }, children)
