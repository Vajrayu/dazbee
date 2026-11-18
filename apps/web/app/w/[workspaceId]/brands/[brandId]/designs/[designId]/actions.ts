'use server'

import type { DesignSummary, SyncToken, VersionSummary } from '@dazbee/schema'

import {
  ApiFailure,
  copyVersion,
  deleteVersion,
  listVersions,
  renameDesign,
  renameVersion,
  saveVersion,
  syncToken,
} from '@/lib/server/api.ts'

/** Renames the design from the editor's crumb (#159); the name it has now, or the old one for an empty name. */
export async function renameFromEditor(
  workspaceId: string,
  brandId: string,
  designId: string,
  name: string,
): Promise<string> {
  const trimmed = name.trim().slice(0, 120)
  if (!trimmed) throw new Error('A design needs a name')
  return (await renameDesign(workspaceId, brandId, designId, trimmed)).name
}

/**
 * A fresh sync token for the editor and when it expires, after the API's workspace and brand checks;
 * null when the API says no (403, 404), which no retry changes. Any other failure is thrown, to be
 * tried again.
 */
export async function fetchSyncToken(
  workspaceId: string,
  brandId: string,
  designId: string,
): Promise<SyncToken | null> {
  try {
    return await syncToken(workspaceId, brandId, designId)
  } catch (error) {
    if (error instanceof ApiFailure && (error.status === 403 || error.status === 404)) return null
    throw error
  }
}

/** The design's versions for the Versions card, newest first. */
export async function versionsOf(workspaceId: string, brandId: string, designId: string): Promise<VersionSummary[]> {
  return listVersions(workspaceId, brandId, designId)
}

/**
 * Saves the design as stored now as a named version, from the Versions card; 'full' when the history
 * is full of named versions, which the card says in the page's words. A design always has a save,
 * from its creation, so the API's other 409 never comes here.
 */
export async function saveVersionFromEditor(
  workspaceId: string,
  brandId: string,
  designId: string,
  name: string,
  description: string,
): Promise<VersionSummary | 'full'> {
  try {
    return await saveVersion(workspaceId, brandId, designId, { name, description })
  } catch (error) {
    if (error instanceof ApiFailure && error.status === 409) return 'full'
    throw error
  }
}

/** Renames a version from the Versions card; null for one deleted meanwhile, which the card's next read leaves out. */
export async function renameVersionFromEditor(
  workspaceId: string,
  brandId: string,
  designId: string,
  versionId: string,
  name: string,
): Promise<VersionSummary | null> {
  try {
    return await renameVersion(workspaceId, brandId, designId, versionId, name)
  } catch (error) {
    if (error instanceof ApiFailure && error.status === 404) return null
    throw error
  }
}

/** Opens a version as a copy: a design of its own in the same brand, named as the page words it. */
export async function copyVersionFromEditor(
  workspaceId: string,
  brandId: string,
  designId: string,
  versionId: string,
  name: string,
): Promise<DesignSummary> {
  return copyVersion(workspaceId, brandId, designId, versionId, name.trim())
}

/** Deletes a version from the Versions card; one already gone counts as deleted. */
export async function deleteVersionFromEditor(
  workspaceId: string,
  brandId: string,
  designId: string,
  versionId: string,
): Promise<void> {
  try {
    await deleteVersion(workspaceId, brandId, designId, versionId)
  } catch (error) {
    if (!(error instanceof ApiFailure && error.status === 404)) throw error
  }
}
