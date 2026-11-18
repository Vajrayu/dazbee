// A layer's flip: what it draws itself, mirrored across its own box's centre lines.
import type { CanvasKit, Path } from '@dazbee/canvaskit'
import type { Flips } from '@dazbee/doc'
import type { Rect } from '@dazbee/schema'

/** The matrix that mirrors a box as its flips say, about its centre; null when it isn't flipped. */
export function flipMatrix(ck: CanvasKit, box: Rect & Flips): number[] | null {
  if (!box.flipX && !box.flipY) return null
  const sx = box.flipX ? -1 : 1
  const sy = box.flipY ? -1 : 1
  return ck.Matrix.multiply(
    ck.Matrix.translated(box.x + box.width / 2, box.y + box.height / 2),
    ck.Matrix.scaled(sx, sy),
    ck.Matrix.translated(-(box.x + box.width / 2), -(box.y + box.height / 2)),
  )
}

/** A path mirrored as the box's flips say; the path itself when it isn't flipped, else freed. */
export function flippedPath(ck: CanvasKit, path: Path, box: Rect & Flips): Path {
  const flip = flipMatrix(ck, box)
  if (!flip) return path
  const builder = new ck.PathBuilder(path)
  path.delete()
  return builder.transform(flip).detachAndDelete()
}
