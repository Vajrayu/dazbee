// The check before export: what the texts of the frames to export won't draw as designed. A family
// the catalog has no file for draws in the fallback fonts, and a character no font has draws as an
// empty box. It reads the design as the export draws it, and writes nothing.
import type { Session } from '@dazbee/doc'
import { missingGraphemes, type SceneLayer, type TextLayout } from '@dazbee/renderer'

import type { FrameScenes } from '../canvas/scenes.ts'
import type { FontCheck } from '../core-interface.ts'
import type { EditorResources } from '../resources.ts'

export interface FontCheckDeps {
  session: Pick<Session, 'design'>
  scenes: Pick<FrameScenes, 'laidOut' | 'layout'>
  resources: Pick<EditorResources, 'load' | 'loaded' | 'lacking'>
}

type TextLayer = Extract<SceneLayer, { type: 'text' }>

export function editorFontCheck({ session, scenes, resources }: FontCheckDeps) {
  /**
   * What each layout misses, read once: a check runs again after each pause in editing, and the
   * texts not edited since keep their layouts.
   */
  const missingIn = new WeakMap<TextLayout, string[]>()

  /** The text layers a scene draws, in the order it draws them. */
  function textsOf(layers: readonly SceneLayer[]): TextLayer[] {
    return layers.flatMap((layer) => (layer.type === 'text' ? [layer] : textsOf(layer.children)))
  }
  /** The families a text names that draw something: its runs' with characters, and its own unless runs cover every one. */
  function familiesOf({ props }: TextLayer): string[] {
    const runs = props.runs.filter((run) => run.end > run.start)
    const covered = new Set<number>()
    for (const run of runs)
      if (run.style.fontFamily)
        for (let at = run.start; at < Math.min(run.end, props.text.length); at++) covered.add(at)
    const own = covered.size < props.text.length ? [props.style.fontFamily] : []
    return [...own, ...runs.flatMap((run) => (run.style.fontFamily ? [run.style.fontFamily] : []))]
  }

  /** The graphemes no font draws in a layout's blocks, each once. */
  function missingOf(laid: TextLayout): string[] {
    let found = missingIn.get(laid)
    if (!found) {
      found = [...new Set(laid.blocks.flatMap((block) => missingGraphemes(block)))]
      missingIn.set(laid, found)
    }
    return found
  }

  /** What the texts of these frames won't draw as designed, once the fonts they name have come or failed to. */
  async function check(frameIds: readonly string[]): Promise<FontCheck> {
    resources.load(session.design(), frameIds)
    await resources.loaded()
    const design = session.design()
    const lacking = new Set(resources.lacking())
    const families = new Set<string>()
    const characters = new Map<string, Set<string>>()
    for (const frameId of frameIds) {
      if (!design.frames[frameId]) continue
      for (const layer of textsOf(scenes.laidOut(frameId, design))) {
        for (const family of familiesOf(layer)) if (lacking.has(family)) families.add(family)
        const name = design.nodes[layer.id]?.name || layer.id
        for (const grapheme of missingOf(scenes.layout(layer.props))) {
          const names = characters.get(grapheme) ?? new Set<string>()
          characters.set(grapheme, names.add(name))
        }
      }
    }
    return {
      families: [...families],
      characters: [...characters].map(([text, layers]) => ({ text, layers: [...layers] })),
    }
  }

  return { check }
}
