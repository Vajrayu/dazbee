import { describe, expect, it } from 'vitest'

import { MEMBER_ROLES } from '@dazbee/schema'

import {
  canAddBrand,
  canChange,
  canInvite,
  canLeave,
  canLimit,
  canRenameWorkspace,
  rowControls,
} from './settings-rights.ts'

/** A row's controls as the letters of those shown: Role menu, Brands, Remove and Hand over; `-` for none. */
const shown = ({ role, brands, remove, handOver }: ReturnType<typeof rowControls>) =>
  [role && 'R', brands && 'B', remove && 'X', handOver && 'H'].filter(Boolean).join('') || '-'

describe('canRenameWorkspace', () => {
  it('lets an Owner or Admin rename the workspace, and no one else', () => {
    expect(MEMBER_ROLES.map((role) => [role, canRenameWorkspace(role)])).toEqual([
      ['owner', true],
      ['admin', true],
      ['editor', false],
      ['reviewer', false],
    ])
  })
})

describe('canChange', () => {
  it('lets every role but a Reviewer change what the library holds', () => {
    expect(MEMBER_ROLES.map((role) => [role, canChange(role)])).toEqual([
      ['owner', true],
      ['admin', true],
      ['editor', true],
      ['reviewer', false],
    ])
  })
})

describe('canAddBrand', () => {
  it('lets every role but a Reviewer add a brand, unless limited to some brands', () => {
    expect(MEMBER_ROLES.map((role) => [role, canAddBrand(role, false), canAddBrand(role, true)])).toEqual([
      ['owner', true, false],
      ['admin', true, false],
      ['editor', true, false],
      ['reviewer', false, false],
    ])
  })
})

describe('canInvite', () => {
  it('lets an Owner or Admin invite and see the pending invites, and no one else', () => {
    expect(MEMBER_ROLES.map((role) => [role, canInvite(role)])).toEqual([
      ['owner', true],
      ['admin', true],
      ['editor', false],
      ['reviewer', false],
    ])
  })
})

describe('canLimit', () => {
  it('shows the brands choice for an Editor or Reviewer only', () => {
    expect(MEMBER_ROLES.map((role) => [role, canLimit(role)])).toEqual([
      ['owner', false],
      ['admin', false],
      ['editor', true],
      ['reviewer', true],
    ])
  })
})

describe('rowControls', () => {
  it('gives an Owner or Admin the role menu and Remove on every other row but the Owner’s, the brands choice on an Editor’s or Reviewer’s, and the Owner Hand over on an Admin’s', () => {
    // Each viewer's row of controls on another member's row of each role, then on their own.
    expect(
      MEMBER_ROLES.map((viewer) => [
        viewer,
        ...MEMBER_ROLES.map((row) => shown(rowControls(viewer, row, false))),
        shown(rowControls(viewer, viewer, true)),
      ]),
    ).toEqual([
      ['owner', '-', 'RXH', 'RBX', 'RBX', '-'],
      ['admin', '-', 'RX', 'RBX', 'RBX', '-'],
      ['editor', '-', '-', '-', '-', '-'],
      ['reviewer', '-', '-', '-', '-', '-'],
    ])
  })
})

describe('canLeave', () => {
  it('lets every role but the Owner leave', () => {
    expect(MEMBER_ROLES.map((role) => [role, canLeave(role)])).toEqual([
      ['owner', false],
      ['admin', true],
      ['editor', true],
      ['reviewer', true],
    ])
  })
})
