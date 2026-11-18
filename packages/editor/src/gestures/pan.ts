// Moving the camera from the stage: a drag with the middle button, with Space held or with the
// hand tool pans; the wheel and the trackpad scroll and zoom.
import type { Point } from '@dazbee/schema'

import type { Camera } from '../canvas/camera.ts'
import type { EditorView } from '../canvas/view.ts'
import type { EditorTools } from '../tools.ts'
import type { KeyInput, PointerInput } from './inputs.ts'

export interface PanDeps {
  view: Pick<EditorView, 'camera' | 'setCamera' | 'stopGlide' | 'viewport' | 'zoomTo'>
  tools: Pick<EditorTools, 'tool'>
  /** Asks for the pointer to be held from the press being handled. */
  hold: () => void
  /** Shows the cursor again: a pan that is ready or held changes it. */
  showCursor: () => void
}

export interface EditorPan {
  /** Whether a press of the main button pans: Space is held, or the hand tool is in use. */
  ready(): boolean
  /** Whether a drag is panning. */
  held(): boolean
  /** A press: the middle button, or the main one while a press pans, starts a pan. Returns whether it did, and so whether the press is the pan's alone. */
  press(e: PointerInput): boolean
  /** The pointer moving: a pan held moves the camera with it. Returns whether one is held. */
  move(e: PointerInput): boolean
  /**
   * The wheel and the trackpad: scrolling pans; pinching (which Chromium sends as a wheel with Ctrl)
   * and a wheel with Ctrl or ⌘ zoom about the pointer.
   */
  wheel(e: PointerInput): void
  /** Ends the pan held, if one is. */
  release(): void
  /**
   * Space held pans with a drag, unless a field has the focus, or a control the keys moved the focus
   * to, which takes space as a press. Returns whether the key was the pan's, so nothing else acts on it.
   */
  keyDown(e: KeyInput): boolean
  /** Space let go stops the pan it held. */
  keyUp(e: KeyInput): void
  /** The window losing focus lets go of space. */
  blur(): void
}

export function editorPan({ view, tools, hold, showCursor }: PanDeps): EditorPan {
  /** A pan by a drag: where it started on the stage, and the camera then. */
  let pan: { from: Point; camera: Camera } | null = null
  /** Whether space is held, which makes a drag pan. */
  let spaceHeld = false

  const ready = () => tools.tool() === 'hand' || spaceHeld

  function press(e: PointerInput) {
    // Middle button, space or the hand tool pan; nothing else does.
    if (e.button !== 1 && !(e.button === 0 && ready())) return false
    hold()
    // The pan starts from where a glide under way is now, which stays there.
    view.stopGlide()
    pan = { from: e.at, camera: view.camera() }
    showCursor()
    return true
  }
  function move(e: PointerInput) {
    if (!pan) return false
    view.setCamera({
      ...pan.camera,
      x: pan.camera.x + e.at.x - pan.from.x,
      y: pan.camera.y + e.at.y - pan.from.y,
    })
    return true
  }
  function release() {
    pan = null
  }
  function wheel(e: PointerInput) {
    const { deltaX = 0, deltaY = 0 } = e
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? view.viewport().height : 1
    if (e.ctrlKey || e.metaKey) {
      const delta = Math.max(-30, Math.min(30, deltaY * unit))
      view.zoomTo(view.camera().zoom * Math.exp(-delta * 0.01), e.at)
      return
    }
    const sideways = e.shiftKey && deltaX === 0
    const dx = (sideways ? deltaY : deltaX) * unit
    const dy = (sideways ? 0 : deltaY) * unit
    const camera = view.camera()
    view.setCamera({ ...camera, x: camera.x - dx, y: camera.y - dy })
  }

  function keyDown(e: KeyInput) {
    if (e.code !== 'Space' || e.metaKey || e.ctrlKey || e.target.field || e.target.control) return false
    if (!spaceHeld) {
      spaceHeld = true
      showCursor()
    }
    return true
  }
  function keyUp(e: KeyInput) {
    if (e.code !== 'Space') return
    spaceHeld = false
    showCursor()
  }
  function blur() {
    spaceHeld = false
    showCursor()
  }

  return { ready, held: () => pan !== null, press, move, release, wheel, keyDown, keyUp, blur }
}
