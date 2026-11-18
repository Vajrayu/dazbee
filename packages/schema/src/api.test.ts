import { describe, expect, it } from 'vitest'

import { faceWeights, MEMBER_ROLES, roleManages, roleWrites } from './api.ts'

describe('roleWrites', () => {
  it('lets an Owner, Admin or Editor write, and a Reviewer only read', () => {
    expect(MEMBER_ROLES.map((role) => [role, roleWrites(role)])).toEqual([
      ['owner', true],
      ['admin', true],
      ['editor', true],
      ['reviewer', false],
    ])
  })
})

describe('roleManages', () => {
  it('lets an Owner or Admin manage the workspace, and no one else', () => {
    expect(MEMBER_ROLES.map((role) => [role, roleManages(role)])).toEqual([
      ['owner', true],
      ['admin', true],
      ['editor', false],
      ['reviewer', false],
    ])
  })
})

describe('faceWeights', () => {
  it('gives a face of one weight that weight', () => {
    expect(faceWeights({ weight: 700 })).toEqual([700])
  })

  it('gives a variable face the hundreds in its range, with its ends and its default weight', () => {
    expect(faceWeights({ weight: 400, weights: { min: 100, max: 900 } })).toEqual([
      100, 200, 300, 400, 500, 600, 700, 800, 900,
    ])
    expect(faceWeights({ weight: 350, weights: { min: 250, max: 750 } })).toEqual([
      250, 300, 350, 400, 500, 600, 700, 750,
    ])
  })
})
