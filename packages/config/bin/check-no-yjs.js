#!/usr/bin/env node
// G8: fails when the lockfile names a Yjs package: yjs, a y-* or @y/* package or @hocuspocus/* (ADR-0015).
import { checkNoYjs } from '../src/no-yjs.ts'

const problems = checkNoYjs(process.cwd())
for (const problem of problems) console.error(`✗ ${problem}`)
if (problems.length > 0) process.exit(1)
console.log('No Yjs package OK')
