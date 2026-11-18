// The routes of the templates a brand can see: saving, renaming and deleting one, its thumbnail, and
// starting a design from it. A member limited to some brands starts designs from a workspace template but
// can't save, rename or delete one, since every brand shares it.
import { type Context, Hono } from 'hono'

import type { Db } from '@dazbee/db'
import { Rename, SaveTemplate, type SignedLink, StartFromTemplate } from '@dazbee/schema'
import type { Storage } from '@dazbee/storage'

import { body, type Env, error, requireWriter } from '../http.ts'
import { signedLink, templateThumbnailKey } from '../storage-keys.ts'
import {
  deleteTemplate,
  findTemplate,
  listTemplates,
  renameTemplate,
  saveTemplate,
  startFromTemplate,
} from './templates.ts'

export function templateRoutes({ db, storage }: { db: Db; storage: Storage }): Hono<Env> {
  const app = new Hono<Env>()

  /** Whether the member is limited to some brands, and so changes no workspace template. */
  const limited = (c: Context<Env>) => c.var.membership.brandIds !== null
  const sharedRefused = (c: Context<Env>) =>
    c.json(error('A member limited to some brands can’t change a template for every brand'), 403)
  /**
   * The route's template as the brand sees it, or the answer when there is none (404) or it is a workspace
   * template a limited member may not change (403).
   */
  const changeable = async (c: Context<Env>) => {
    const template = await findTemplate(
      db,
      c.var.membership.workspaceId,
      c.var.brand.id,
      c.req.param('templateId') ?? '',
    )
    if (!template) return c.json(error('No such template'), 404)
    if (template.scope === 'workspace' && limited(c)) return sharedRefused(c)
    return template
  }

  // Templates (#54): the workspace's and the brand's, a design saved to start others from.
  app.get('/brands/:brandId/templates', async (c) => {
    const { workspaceId } = c.var.membership
    return c.json(await listTemplates(db, workspaceId, c.var.brand.id))
  })

  app.post('/brands/:brandId/templates', requireWriter, async (c) => {
    const { workspaceId } = c.var.membership
    const input = await body(c.req.raw, SaveTemplate)
    if (input instanceof Response) return input
    if (input.scope === 'workspace' && limited(c)) return sharedRefused(c)
    return c.json(await saveTemplate(db, storage, workspaceId, c.var.brand.id, input), 201)
  })

  app.patch('/brands/:brandId/templates/:templateId', requireWriter, async (c) => {
    const input = await body(c.req.raw, Rename)
    if (input instanceof Response) return input
    const found = await changeable(c)
    if (found instanceof Response) return found
    const template = await renameTemplate(
      db,
      c.var.membership.workspaceId,
      c.var.brand.id,
      c.req.param('templateId'),
      input.name,
    )
    return template ? c.json(template) : c.json(error('No such template'), 404)
  })

  app.delete('/brands/:brandId/templates/:templateId', requireWriter, async (c) => {
    const found = await changeable(c)
    if (found instanceof Response) return found
    const deleted = await deleteTemplate(
      db,
      storage,
      c.var.membership.workspaceId,
      c.var.brand.id,
      c.req.param('templateId'),
    )
    return deleted ? c.body(null, 204) : c.json(error('No such template'), 404)
  })

  app.get('/brands/:brandId/templates/:templateId/thumbnail', async (c) => {
    const { workspaceId } = c.var.membership
    const template = await findTemplate(db, workspaceId, c.var.brand.id, c.req.param('templateId'))
    if (!template) return c.json(error('No such template'), 404)
    return c.json((await signedLink(storage, templateThumbnailKey(workspaceId, template.id))) satisfies SignedLink)
  })

  app.post('/brands/:brandId/templates/:templateId/designs', requireWriter, async (c) => {
    const { workspaceId } = c.var.membership
    const input = await body(c.req.raw, StartFromTemplate)
    if (input instanceof Response) return input
    const design = await startFromTemplate(db, workspaceId, c.var.brand.id, c.req.param('templateId'), input.name)
    return design ? c.json(design, 201) : c.json(error('No such template'), 404)
  })

  return app
}
