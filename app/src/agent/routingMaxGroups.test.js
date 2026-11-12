// ⛔ RAIL: the server keeps only the first MAX_GROUPS routing groups (api/services/uct_agent/turn.py
// validate_routing). Groups past it are dropped SILENTLY from the model's "other action groups" list and the
// `need_groups` enum, so a request that needs the last group can never reroute to it. Found 2026-11-11: master
// was exactly at 24, and #1074's 25th group (layoutBar) pushed `guide` off. This reads the server constant from
// turn.py's text and fails the moment routing.js outgrows it.
import fs from 'node:fs'
import path from 'node:path'
import { it, expect } from 'vitest'
import { GROUPS } from './routing'

const TURN = path.resolve(__dirname, '../../../api/services/uct_agent/turn.py')

export function serverMaxGroups(text = fs.readFileSync(TURN, 'utf8')) {
  const m = text.match(/^MAX_GROUPS\s*=\s*(\d+)\s*$/m)
  return m ? Number(m[1]) : null
}

it('routing.js GROUPS fit in the server\'s MAX_GROUPS (turn.py)', () => {
  const max = serverMaxGroups()
  expect(max, 'MAX_GROUPS = <n> not found in api/services/uct_agent/turn.py').toBeGreaterThan(0)
  const n = GROUPS.length
  expect(n <= max, `routing has ${n} groups but the server keeps only MAX_GROUPS = ${max}; raise it in turn.py`).toBe(true)
})
