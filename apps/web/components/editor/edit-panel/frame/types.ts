import type { Editor } from '@dazbee/editor'
import type { Design } from '@dazbee/schema'

/** What a section of the picked frame's switcher tabs is given: the frame, the design it is in, and the brand whose kit it offers. */
export interface FrameSectionProps {
  editor: Editor
  design: Design
  frameId: string
  workspaceId: string
  brandId: string
}
