// The stage the gesture matrix runs on, and the edges the editor's chrome covers there. The Node
// driver opens the test editor with them, so every run fits a frame to the same zoom and draws the
// same handles.
import type { Insets, Viewport } from '../canvas/camera.ts'

/** The stage's size, in CSS pixels: 1600 × 1000. */
export const MATRIX_STAGE: Viewport = { width: 1600, height: 1000 }
/** The stage's edges the chrome covers at that size, as the page tells the editor them. */
export const MATRIX_INSETS: Insets = { top: 140, right: 0, bottom: 73.5, left: 94.5 }
