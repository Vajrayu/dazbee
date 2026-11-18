// What a member's role lets them see and use outside the editor: Settings' controls, and the library's
// controls that change something. The API refuses the same changes, so these only hide what can't apply.
import {
  type MemberBrands,
  type MemberRole,
  roleLimitable,
  roleManages,
  roleWrites,
  type TemplateScope,
} from '@dazbee/schema'

/** The controls a row of This workspace's Members shows its viewer. */
export interface RowControls {
  /** The menu that changes the member's role. */
  role: boolean
  /** The choice of the brands the member may see. */
  brands: boolean
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
 * Whether the role sees New brand: every role but a Reviewer, unless `limited` to some brands, as a member
 * who sees only the brands given to them can't add one.
 */
export const canAddBrand = (role: MemberRole, limited: boolean) => roleWrites(role) && !limited

/**
 * Whether the role saves, renames and deletes a template for `scope`: every role but a Reviewer, and for
 * every brand (`workspace`) only one not `limited` to some brands, since every brand shares that template.
 */
export const canChangeTemplate = (role: MemberRole, limited: boolean, scope: TemplateScope) =>
  roleWrites(role) && (scope === 'brand' || !limited)

/**
 * Whether the role sees This workspace's Invite and its pending invites, whose links let anyone in:
 * an Owner or Admin.
 */
export const canInvite = (role: MemberRole) => roleManages(role)

/** Whether an invite or a member with the role shows the brands choice: an Editor or Reviewer. */
export const canLimit = (role: MemberRole) => roleLimitable(role)

/**
 * Whether giving a member `role` asks first: a member limited to some brands (`brandIds` a list) made an
 * Admin, who sees every brand. Moving between Editor and Reviewer keeps their brands, and asks nothing.
 */
export const asksBeforeRole = (brandIds: MemberBrands, role: MemberRole) => brandIds !== null && !roleLimitable(role)

/** Whether the role sees Leave on its workspace: every role but the Owner, who hands over Owner first. */
export const canLeave = (role: MemberRole) => role !== 'owner'

/**
 * The controls the viewer sees on a member's row (`own` when it is the viewer's): an Owner or Admin
 * changes the role of, and removes, every other member but the Owner, and chooses the brands of an Editor
 * or Reviewer; the Owner alone hands over Owner, to an Admin.
 */
export function rowControls(viewer: MemberRole, row: MemberRole, own: boolean): RowControls {
  const manages = roleManages(viewer) && !own && row !== 'owner'
  return {
    role: manages,
    brands: manages && canLimit(row),
    remove: manages,
    handOver: viewer === 'owner' && !own && row === 'admin',
  }
}
