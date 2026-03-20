#!/usr/bin/env bun
import { run } from './index.js'

run(process.argv.slice(2)).catch((err) => {
  // Commander throws with exitCode for --help, parse errors, etc.
  if (err?.exitCode !== undefined) process.exit(err.exitCode)
  console.error(err?.message ?? err)
  process.exit(1)
})
