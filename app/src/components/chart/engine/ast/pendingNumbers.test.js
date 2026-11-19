// A FUNCTION WAITING ON AN ENGINE NUMBER IS NAMED IN THE VERSION FILE.
//
// ⚰️ 2026-11-18. `fisher(length)` merged into the expansion module with "NUMBER PENDING" written in
// its comments and NO pending line in `scriptEngineVersion.js`. The train that numbered the engine
// next read the version file, found nothing waiting, and left it unnumbered. Nothing could have
// caught it: the version rail checks only that the number parses, and a rule of "a pending comment
// needs a pending line" cannot be turned on, because comments from trains numbered long ago still
// say "NUMBER PENDING" in a dozen engine files.
//
// So the mark is DATA, not a comment. An entry of `CALL_EXPANSIONS` that waits on a number carries
// `pending: true`, and this file holds each one to being named, by its signature, in a
// `/** NUMBER PENDING = ... */` line of the version file. When the coordinator numbers the train,
// the line becomes that number's entry and the mark comes off the registry entry, in one change:
// a mark left behind fails here (nothing pending names it any more), and so does a line left
// behind (it names a function that is no longer waiting).

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CALL_EXPANSIONS } from './callExpansions'

const here = path.dirname(fileURLToPath(import.meta.url))
const VERSION_FILE = fs.readFileSync(path.resolve(here, '../scriptEngineVersion.js'), 'utf8')

/** The text of every `/** NUMBER PENDING = ... *\/` entry of a version file. */
export function pendingLines(text) {
  return [...text.matchAll(/\/\*\* NUMBER PENDING = [\s\S]*?\*\//g)].map((m) => m[0])
}
/** The signatures a registry marks as waiting on a number. */
const pendingSignatures = (registry) => Object.values(registry).filter((spec) => spec.pending === true).map((spec) => spec.signature)
/** What is wrong, as sentences: a marked entry no pending line names, or a pending line naming an entry that is not marked. */
export function problems(registry, text) {
  const lines = pendingLines(text)
  const out = []
  for (const signature of pendingSignatures(registry)) {
    if (!lines.some((line) => line.includes('`' + signature + '`'))) {
      out.push(`${signature} is marked pending and no NUMBER PENDING line of scriptEngineVersion.js names it`)
    }
  }
  for (const spec of Object.values(registry)) {
    if (spec.pending !== true && lines.some((line) => line.includes('`' + spec.signature + '`'))) {
      out.push(`${spec.signature} is named in a NUMBER PENDING line and its registry entry is not marked pending`)
    }
  }
  return out
}

describe('an expansion waiting on an engine number', () => {
  it('⛔ is named, by its signature, in a NUMBER PENDING line of the version file', () => {
    expect(problems(CALL_EXPANSIONS, VERSION_FILE)).toEqual([])
  })

  it('`pending` is exactly true or absent, and the version number itself is still one declaration', () => {
    for (const [name, spec] of Object.entries(CALL_EXPANSIONS)) {
      expect(spec.pending === undefined || spec.pending === true, name).toBe(true)
    }
    expect(VERSION_FILE.match(/^export const SCRIPT_ENGINE_VERSION = \d+$/gm)).toHaveLength(1)
  })

  it('CONTROL: the rail can fail, both ways', () => {
    const registry = { fisher: { pending: true, signature: 'fisher(length)' }, roc: { signature: 'roc(source, length)' } }
    const line = '/** NUMBER PENDING = (a branch) the function `fisher(length)` and what it is. */\nexport const SCRIPT_ENGINE_VERSION = 1\n'
    expect(problems(registry, line)).toEqual([])
    // the incident: marked, and the version file says nothing
    expect(problems(registry, 'export const SCRIPT_ENGINE_VERSION = 1\n')).toEqual([
      'fisher(length) is marked pending and no NUMBER PENDING line of scriptEngineVersion.js names it'])
    // a NUMBERED entry that mentions it is not a pending line
    expect(problems(registry, '/** 79 = the function `fisher(length)`. */\n')).toHaveLength(1)
    // numbered and the mark left on: the line is gone, so the mark is caught
    expect(problems(registry, '/** 79 = (the train) `fisher(length)`. */\n')[0]).toContain('marked pending')
    // the mark taken off and the line left behind
    const numbered = { fisher: { signature: 'fisher(length)' } }
    expect(problems(numbered, line)).toEqual([
      'fisher(length) is named in a NUMBER PENDING line and its registry entry is not marked pending'])
    // a pending line about something else entirely names no expansion and is nobody's problem here
    expect(problems(numbered, '/** NUMBER PENDING = (another branch) a translator change. */\n')).toEqual([])
  })
})
