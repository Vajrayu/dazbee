'use server'

// What the brand's pages do to its designs and templates (#54, #159): each takes the workspace and
// the brand first, so a page binds them, and the page draws again with the change.
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { brandPath } from '@/lib/brand-routes.ts'
import {
  deleteDesign,
  deleteTemplate,
  duplicateDesign,
  renameDesign,
  renameTemplate,
  startFromTemplate,
} from '@/lib/server/api.ts'

/** The name a rename form sends, trimmed to what the API takes. */
const nameOf = (form: FormData) =>
  String(form.get('name') ?? '')
    .trim()
    .slice(0, 120)

const changed = (workspaceId: string, brandId: string) => revalidatePath(brandPath(workspaceId, brandId), 'layout')

/** Starts a design from a template: the brand's own copy, with fresh ids. */
export async function startTemplate(workspaceId: string, brandId: string, templateId: string) {
  const design = await startFromTemplate(workspaceId, brandId, templateId)
  redirect(brandPath(workspaceId, brandId, 'designs', design.id))
}

export async function renameDesignAction(workspaceId: string, brandId: string, designId: string, form: FormData) {
  const name = nameOf(form)
  if (name) await renameDesign(workspaceId, brandId, designId, name)
  changed(workspaceId, brandId)
}

export async function duplicateDesignAction(workspaceId: string, brandId: string, designId: string) {
  await duplicateDesign(workspaceId, brandId, designId)
  changed(workspaceId, brandId)
}

export async function deleteDesignAction(workspaceId: string, brandId: string, designId: string) {
  await deleteDesign(workspaceId, brandId, designId)
  changed(workspaceId, brandId)
}

export async function renameTemplateAction(workspaceId: string, brandId: string, templateId: string, form: FormData) {
  const name = nameOf(form)
  if (name) await renameTemplate(workspaceId, brandId, templateId, name)
  changed(workspaceId, brandId)
}

export async function deleteTemplateAction(workspaceId: string, brandId: string, templateId: string) {
  await deleteTemplate(workspaceId, brandId, templateId)
  changed(workspaceId, brandId)
}
