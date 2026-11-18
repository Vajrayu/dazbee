import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { defineCommand, mapInside, strict } from './define.ts'

const define = (input: z.ZodType) => () =>
  defineCommand({ name: 'test.input', description: 'A test.', step: 'edit', input, apply: () => undefined })

describe('defineCommand', () => {
  it('takes an input whose every object is strict, with open records in it', () => {
    const input = z.strictObject({
      id: z.string().optional(),
      patch: z.record(z.string(), z.unknown()),
      boxes: z.record(z.string(), z.strictObject({ x: z.number() })).optional(),
      op: z.discriminatedUnion('kind', [
        z.strictObject({ kind: z.literal('insert'), text: z.string() }),
        z.strictObject({ kind: z.literal('delete'), length: z.number() }),
      ]),
    })
    expect(define(input)).not.toThrow()
  })

  it.each([
    ['the input', z.object({ id: z.string() })],
    ['frame', z.strictObject({ frame: z.object({ name: z.string() }) })],
    ['lock', z.strictObject({ lock: z.looseObject({ move: z.boolean() }).optional() })],
    ['ids.[]', z.strictObject({ ids: z.object({ id: z.string() }).array().min(1) })],
    ['boxes.{}', z.strictObject({ boxes: z.record(z.string(), z.object({ x: z.number() })).default({}) })],
    ['op.|1', z.strictObject({ op: z.union([z.strictObject({ a: z.string() }), z.object({ b: z.string() })]) })],
    ['at.[1]', z.strictObject({ at: z.tuple([z.number(), z.object({ x: z.number() })]).nullable() })],
  ])('refuses an input that takes unknown keys at %s', (where, input) => {
    expect(define(input)).toThrow(`test.input: the object at ${where} takes keys it does not name`)
  })
})

describe('defineCommand, given a kind of type its check of strictness does not know', () => {
  const Tree: z.ZodType = z.lazy(() => z.object({ kids: Tree.array() }))

  it.each([
    ['lazy', 'tree', z.strictObject({ tree: Tree })],
    ['intersection', 'both', z.strictObject({ both: z.object({ a: z.string() }).and(z.object({ b: z.string() })) })],
    ['map', 'by.[]', z.strictObject({ by: z.map(z.string(), z.object({ a: z.string() })).array() })],
  ])('refuses the kind %s, which could hold an object that takes any key', (kind, where, input) => {
    expect(define(input)).toThrow(
      `test.input: the ${kind} at ${where} is a kind of type the check of strictness does not know`,
    )
  })
})

describe('strict', () => {
  const Stop = z.object({ offset: z.number().default(0), color: z.string() })
  const Paint = z.discriminatedUnion('type', [
    z.object({ type: z.literal('solid'), color: z.string() }),
    z.object({ type: z.literal('linear'), stops: Stop.array().min(2), from: z.tuple([z.number(), z.number()]) }),
  ])
  const Style = z
    .object({ fills: Paint.array().optional(), opacity: z.number(), by: z.record(z.string(), Stop).nullable() })
    .refine((style) => style.opacity <= 1, 'opacity is at most 1')

  it('gives a type that takes what the type takes, with its defaults and its own checks', () => {
    const fills = [{ type: 'linear', stops: [{ color: 'a' }, { offset: 1, color: 'b' }], from: [0, 1] }]
    const taken = { fills, opacity: 1, by: { first: { color: 'c' } } }
    expect(strict(Style).parse(taken)).toEqual(Style.parse(taken))
    expect(strict(Style).safeParse({ opacity: 2, by: null }).error?.issues[0]?.message).toBe('opacity is at most 1')
    expect(define(z.strictObject({ style: strict(Style) }))).not.toThrow()
  })

  it.each([
    ['the type itself', { opacity: 1, by: null, junk: 1 }],
    ['a list in it', { opacity: 1, by: null, fills: [{ type: 'solid', color: 'a', junk: 1 }] }],
    [
      'a list deeper in it',
      {
        opacity: 1,
        by: null,
        fills: [{ type: 'linear', from: [0, 1], stops: [{ color: 'a' }, { color: 'b', junk: 1 }] }],
      },
    ],
    ['a record in it', { opacity: 1, by: { first: { color: 'c', junk: 1 } } }],
  ])('refuses a key the type does not name in %s, which the type itself takes', (_, value) => {
    expect(Style.safeParse(value).success).toBe(true)
    expect(strict(Style).safeParse(value).success).toBe(false)
  })
})

describe('mapInside', () => {
  it('visits each type inside a type with where it sits, a tuple’s items, its rest and both sides of a pipe included', () => {
    const seen: [string, boolean][] = []
    const visit = (inside: z.ZodType, where: string, field: boolean) => (seen.push([where, field]), inside)
    mapInside(z.object({ a: z.string(), b: z.number() }), visit)
    mapInside(z.tuple([z.string(), z.number()], z.boolean()), visit)
    mapInside(z.string().array(), visit)
    mapInside(z.record(z.string(), z.number()), visit)
    mapInside(z.union([z.string(), z.number()]), visit)
    mapInside(z.string().optional(), visit)
    mapInside(z.string().pipe(z.string()), visit)
    expect(seen).toEqual([
      ['a', true],
      ['b', true],
      ['[0]', false],
      ['[1]', false],
      ['[]', false],
      ['[]', false],
      ['{}', false],
      ['|0', false],
      ['|1', false],
      ['', false],
      ['', false],
      ['', false],
    ])
  })
})
