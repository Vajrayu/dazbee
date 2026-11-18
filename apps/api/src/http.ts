// What every area's routes share: the context they run in, the error body, reading a request's body,
// the check that a request has a session, the membership of the workspace a route is for, the checks
// that its role writes or manages the workspace, and the brand a brand route is for.
import type { MiddlewareHandler } from 'hono'
import type { z } from 'zod'

import type { Db } from '@dazbee/db'
import { type ApiError, type BrandSummary, type MemberRole, roleManages, roleWrites } from '@dazbee/schema'

import type { Session, SessionOf } from './sign-in/session.ts'
import { findBrand, findRole } from './workspace/workspace.ts'

/** A person's place in the workspace a route is for: that workspace, and their role there. */
export interface Membership {
  workspaceId: string
  role: MemberRole
}

/**
 * A route's context: the session `requireSession` found; on every route of a workspace, the membership
 * `membershipScope` found; and on every route below a brand, the brand `brandScope` found in that
 * membership's workspace.
 */
export type Env = { Variables: { session: Session; membership: Membership; brand: BrandSummary } }

/** The body of every error answer. */
export const error = (message: string): ApiError => ({ error: message })

/** The body parsed with `schema`, or a 400 response saying what's wrong with it. */
export async function body<T extends z.ZodType>(request: Request, schema: T): Promise<z.infer<T> | Response> {
  let json: unknown
  try {
    json = await request.json()
  } catch {
    return Response.json(error('The body is not JSON'), { status: 400 })
  }
  const parsed = schema.safeParse(json)
  if (!parsed.success)
    return Response.json(
      error(parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ')),
      { status: 400 },
    )
  return parsed.data
}

/** Answers 401 to a request `sessionOf` finds no session for; otherwise puts its session on the context. */
export function requireSession(sessionOf: SessionOf): MiddlewareHandler<Env> {
  return async (c, next) => {
    const session = await sessionOf(c.req.raw)
    if (!session) return c.json(error('Sign in first'), 401)
    c.set('session', session)
    await next()
  }
}

/**
 * Answers 404 "No such workspace" unless the session's person is a member of the route's `:workspaceId`;
 * otherwise puts their membership on the context. It runs after `requireSession`.
 */
export function membershipScope(db: Db): MiddlewareHandler<Env> {
  return async (c, next) => {
    const workspaceId = c.req.param('workspaceId') ?? ''
    const role = await findRole(db, workspaceId, c.var.session.userId)
    if (!role) return c.json(error('No such workspace'), 404)
    c.set('membership', { workspaceId, role })
    await next()
  }
}

/** Answers 403 to a member whose role does not write (a Reviewer); it runs after the membership's check. */
export const requireWriter: MiddlewareHandler<Env> = async (c, next) => {
  if (!roleWrites(c.var.membership.role)) return c.json(error('Only an Owner, Admin or Editor can do this'), 403)
  await next()
}

/**
 * Answers 403 to a member who is not an Owner or Admin, who alone manage the workspace; it runs after the
 * membership's check.
 */
export const requireManager: MiddlewareHandler<Env> = async (c, next) => {
  if (!roleManages(c.var.membership.role)) return c.json(error('Only an Owner or Admin can do this'), 403)
  await next()
}

/**
 * Answers 404 "No such brand" when the route's `:brandId` is not a brand of the membership's workspace;
 * otherwise puts the brand on the context. It runs after the membership's check.
 */
export function brandScope(db: Db): MiddlewareHandler<Env> {
  return async (c, next) => {
    const brand = await findBrand(db, c.var.membership.workspaceId, c.req.param('brandId') ?? '')
    if (!brand) return c.json(error('No such brand'), 404)
    c.set('brand', brand)
    await next()
  }
}
