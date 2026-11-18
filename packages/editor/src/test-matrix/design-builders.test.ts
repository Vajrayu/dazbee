import { describe, expect, it } from 'vitest'

import { sortedJson } from './design-builders.ts'

describe('sortedJson', () => {
  it("gives every object's keys sorted, however deep, with arrays in their order", () => {
    expect(sortedJson({ b: 1, a: { d: [{ z: 1, y: 2 }, 3], c: null } })).toBe(
      '{"a":{"c":null,"d":[{"y":2,"z":1},3]},"b":1}',
    )
  })

  it('reads the same for two objects that differ only in the order of their keys', () => {
    expect(sortedJson({ nodes: { b: { x: 1, y: 2 }, a: {} }, meta: 'm' })).toBe(
      sortedJson({ meta: 'm', nodes: { a: {}, b: { y: 2, x: 1 } } }),
    )
  })

  it('leaves out keys whose value is undefined, as JSON does', () => {
    expect(sortedJson({ b: undefined, a: 1 })).toBe('{"a":1}')
  })
})
