// What the commands are, for a caller that has not read the code, such as an agent: each command's
// name, what it does, and its input as JSON Schema, made from the definitions by zod's converter.
import { z } from 'zod'

import { type CommandName, COMMANDS } from './index.ts'

/** One command as the catalog lists it. */
export interface CatalogEntry<N extends string = string> {
  name: N
  description: string
  /** The input a caller sends, as JSON Schema (draft 2020-12): a field with a default may be left out. */
  input: z.core.JSONSchema.BaseSchema
}

/**
 * Every command, in the order `COMMANDS` lists them. It throws, naming the command, on an input
 * holding a type JSON Schema cannot express, so no command is listed with part of its input missing.
 */
export function commandCatalog(): CatalogEntry<CommandName>[] {
  return Object.values(COMMANDS).map(({ name, description, input }) => {
    try {
      const schema = z.toJSONSchema(input, { io: 'input', unrepresentable: 'throw' })
      return { name: name as CommandName, description, input: schema }
    } catch (error) {
      throw new Error(`${name}: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
    }
  })
}
