// The gesture matrix for the test suites: the pure design builders its design is made with, with
// a design as sorted JSON, the runner of its rows with every expectation, the parts the suites run
// them in, the stage it runs on, and the driver interface
// they ask of an open editor. No module of the package imports it.
export { copyIn, type Design, frameDesign, layersIn, linkedFrames, type Seeded, sortedJson } from './design-builders.ts'
export { type MatrixDriver } from './driver.ts'
export { matrixDesign, SUBJECTS } from './matrix-design.ts'
export { MATRIX_INSETS, MATRIX_STAGE } from './matrix-stage.ts'
export { matrixParts, matrixRows, runMatrix } from './run-matrix.ts'
export { FRAME_IDS, type FrameId, idIn } from './run-row.ts'
