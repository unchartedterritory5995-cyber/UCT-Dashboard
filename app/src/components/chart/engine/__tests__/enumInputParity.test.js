// app/src/components/chart/engine/__tests__/enumInputParity.test.js
//
// ⭐⭐ ONE ENUM RULE, CLIENT AND SERVER. The tree lanes read a text enum as its
// option's index (`nativeRegistry.treeScalars`); the alert evaluator does the same
// on the server (`api/services/alert_user_series._inputs_for`). They used to
// disagree on unknown text, a numeric value and a default not among the options.
// Both suites now read ONE fixture (`tests/fixtures/enum_input_parity.json`) — the
// pytest twin is `tests/test_enum_input_parity.py` — so they cannot drift apart.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveInputs, treeScalars } from '../nativeRegistry'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../..')
const FIXTURE = JSON.parse(fs.readFileSync(path.join(REPO, 'tests/fixtures/enum_input_parity.json'), 'utf8'))

describe('enum inputs reach a tree as one index, by one rule', () => {
  it('NON-VACUITY: the fixture covers every disputed case', () => {
    expect(FIXTURE.cases.length).toBeGreaterThanOrEqual(12)
  })
  for (const c of FIXTURE.cases) {
    it(`${c.name} → index ${c.index}`, () => {
      const def = { inputs: [c.input] }
      const stored = c.absent ? {} : { [c.input.key]: c.value }
      expect(treeScalars(def, resolveInputs(def, stored))[c.input.key]).toBe(c.index)
    })
  }
})
