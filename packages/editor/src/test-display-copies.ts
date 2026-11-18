// Encoded images and a display copy maker answered by hand, for the display copies' tests.
import { loadCanvasKit } from '@dazbee/renderer/node'

import { type CopyMaker, displayCopies, madeCopy } from './display-copies.ts'

const ck = await loadCanvasKit()

/**
 * The PNG bytes of an image of a size, its left half opaque green and its right half clear; or its
 * JPEG bytes, which have no alpha and decode opaque.
 */
export function halfPng(width: number, height: number, jpeg = false): Uint8Array {
  const surface = ck.MakeSurface(width, height)
  if (!surface) throw new Error('no surface')
  const canvas = surface.getCanvas()
  canvas.clear(ck.TRANSPARENT)
  const paint = new ck.Paint()
  paint.setColor(ck.Color(10, 200, 90, 1))
  canvas.drawRect(ck.XYWHRect(0, 0, width / 2, height), paint)
  paint.delete()
  const image = surface.makeImageSnapshot()
  const png = jpeg ? image.encodeToBytes(ck.ImageFormat.JPEG, 90) : image.encodeToBytes()
  image.delete()
  surface.delete()
  if (!png) throw new Error('could not encode')
  return png
}

/** Display copies made by a maker the test answers by hand, with a count of changes. */
export function asked(bytes: Record<string, Uint8Array>) {
  const jobs: { side: number; answer: (fail?: Error) => void }[] = []
  const maker: CopyMaker = (encoded, side) =>
    new Promise((resolve, reject) =>
      jobs.push({
        side,
        answer: (fail) => (fail ? reject(fail) : resolve(madeCopy(ck, encoded, side))),
      }),
    )
  let changes = 0
  const failed: string[] = []
  const waits: (() => void)[] = []
  const made = displayCopies({
    ck,
    encoded: (assetId) => bytes[assetId],
    changed: () => changes++,
    failed: (assetId) => failed.push(assetId),
    maker,
    after: (_, run) => {
      waits.push(run)
      return () => {}
    },
  })
  return { made, jobs, failed, waits, changes: () => changes }
}

/** One turn of the event loop, for answered copies to land. */
export function settle() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}
