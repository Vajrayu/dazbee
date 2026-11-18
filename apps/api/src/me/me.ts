// The signed-in person across their workspaces: who they are, the workspaces they are a member of, and
// the one to open.
import { asc, eq } from 'drizzle-orm'

import { type Db, memberships, users, workspaces } from '@dazbee/db'
import type { Me } from '@dazbee/schema'

import { workspaceToOpen } from '../workspace/workspace.ts'

/**
 * The person, their workspaces by name with their role and whether they are limited to some brands there,
 * and the one to open; null when there is no such person.
 */
export async function findMe(db: Db, userId: string): Promise<Me | null> {
  const [[user], theirs, open] = await Promise.all([
    db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(eq(users.id, userId)),
    db
      .select({ id: workspaces.id, name: workspaces.name, role: memberships.role, limited: memberships.limited })
      .from(memberships)
      .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
      .where(eq(memberships.userId, userId))
      .orderBy(asc(workspaces.name), asc(workspaces.id)),
    workspaceToOpen(db, userId),
  ])
  return user ? { ...user, workspaces: theirs, open } : null
}
