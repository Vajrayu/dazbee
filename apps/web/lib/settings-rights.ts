// What a member's role lets them see and use outside the editor: Settings' controls, and the library's
// controls that change something. The API refuses the same changes, so these only hide what can't apply.
import { type MemberRole, roleManages, roleWrites } from '@dazbee/schema'

/** The controls a row of This workspace's Members shows its viewer. */
export interface RowControls {
  /** The menu that changes the member's role. */
  role: boolean
  remove: boolean
  /** Hand over Owner, which makes the member the Owner. */
  handOver: boolean
}

/** Whether the role sees This workspace's name as a field it can save: an Owner or Admin. */
export const canRenameWorkspace = (role: MemberRole) => roleManages(role)

/**
 * Whether the role sees the library's controls that change something: New design and the brief, a
 * tile's rename, duplicate and delete, starting from a template, uploads and the brand kit's editing.
 * Every role but a Reviewer.
 */
export const canChange = (role: MemberRole) => roleWrites(role)

/**
 * Whether the role sees This workspace's Invite and its pending invites, whose links let anyone in:
 * an Owner or Admin.
 */
export const canInvite = (role: MemberRole) => roleManages(role)

/** Whether the role sees Leave on its workspace: every role but the Owner, who hands over Owner first. */
export const canLeave = (role: MemberRole) => role !== 'owner'

/**
 * The controls the viewer sees on a member's row (`own` when it is the viewer's): an Owner or Admin
 * changes the role of, and removes, every other member but the Owner, and the Owner alone hands over
 * Owner, to an Admin.
 */
export function rowControls(viewer: MemberRole, row: MemberRole, own: boolean): RowControls {
  const manages = roleManages(viewer) && !own && row !== 'owner'
  return { role: manages, remove: manages, handOver: viewer === 'owner' && !own && row === 'admin' }
}
