// A command with a bug, for the tests of what a fault leaves on the stage: it moves layers and then throws.
import { afterAll, beforeAll } from 'vitest'

import { CommandFault, type CommandName, COMMANDS, defineCommand, type Session } from '@dazbee/doc'

/** Takes layers as `node.hug` names them. */
const BUGGY = defineCommand({
  name: 'test.throw',
  description: 'Moves layers, then throws.',
  step: 'edit',
  batchable: true,
  input: COMMANDS['node.hug'].input,
  apply: ({ w }, { ids }) => {
    for (const id of ids) w.setProp(id, 'x', 999)
    throw new Error('boom')
  },
})
const registry = COMMANDS as Record<string, unknown>

/** Registers the command for the tests of the file or `describe` this is called in. */
export function registerFaultyCommand() {
  beforeAll(() => {
    registry[BUGGY.name] = BUGGY
  })
  afterAll(() => {
    Reflect.deleteProperty(registry, BUGGY.name)
  })
}

/** Runs the command on layers, and gives the fault the session throws for it. */
export function faultOn(session: Session, ids: string[]): CommandFault {
  try {
    session.run(BUGGY.name as never, { ids } as never)
  } catch (error) {
    if (error instanceof CommandFault) return error
    throw error
  }
  throw new Error('the command with a bug did not fault')
}

/**
 * Runs `during` with a command replaced by one with a bug, which takes the same input and runs
 * where it does: it renames the design and then throws.
 */
export function withFaulty(name: CommandName, during: () => void) {
  const real = registry[name]
  registry[name] = defineCommand({
    name,
    description: 'Renames the design, then throws.',
    step: COMMANDS[name].step,
    ...(COMMANDS[name].batchable && { batchable: true }),
    input: COMMANDS[name].input,
    apply: ({ w }) => {
      w.setMeta('name', 'half written')
      throw new Error('boom')
    },
  })
  try {
    during()
  } finally {
    registry[name] = real
  }
}
