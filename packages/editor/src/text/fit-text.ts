// The editor's half of the recompute (D6): the box a text that grows with its words takes, measured
// as typing measures it, in the fonts the screen draws with. A text waits while a font it is drawn
// in (`textFamilies`: its own, its runs' and the script fonts its characters need) is still coming;
// once that load settles, with files or without, it is measured with what is here, the fallbacks for
// a font that never came, as typing would measure it then.
import { fittedText, type FitText } from '@dazbee/doc'
import { type Layer, textFamilies } from '@dazbee/schema'

import type { FrameScenes } from '../canvas/scenes.ts'
import type { EditorResources } from '../resources.ts'

interface FitTextDeps {
  scenes: Pick<FrameScenes, 'measure'>
  resources: Pick<EditorResources, 'bytes' | 'loadFamilies' | 'pending'>
}

/**
 * The doc's `FitText` on the editor's measure: `'wait'` while a family a text that grows with its
 * words is drawn in is loading. A fixed box, or another layer, has nothing to fit and waits for nothing.
 */
export function editorFitText({ scenes, resources }: FitTextDeps): FitText {
  return (layer: Layer) => {
    if (layer.type !== 'text' || layer.props.boxMode === 'fixed') return undefined
    const { variables } = resources.bytes()
    const families = textFamilies(layer, variables)
    resources.loadFamilies(families)
    if (families.some((family) => resources.pending(family))) return 'wait'
    return fittedText(layer, scenes.measure(), variables)
  }
}
