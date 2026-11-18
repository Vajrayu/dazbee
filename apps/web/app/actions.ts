'use server'

import { redirect } from 'next/navigation'

import { brandFromForm, madeHref } from '@/lib/brand-start.ts'
import { createBrand } from '@/lib/server/api.ts'

/** Adds a brand to the workspace from its website or name, and opens its home, saying the brand is ready. */
export async function addBrand(workspaceId: string, form: FormData) {
  const brand = brandFromForm(form)
  if (!brand) return
  const made = await createBrand(workspaceId, brand.name, brand.website)
  redirect(madeHref(workspaceId, made.id))
}
