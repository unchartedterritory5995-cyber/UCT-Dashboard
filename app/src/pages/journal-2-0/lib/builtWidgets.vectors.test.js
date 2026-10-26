// Notebook widgets phase 2, wave 11 (Task 11.5): the client twin of the server's template fill
// (api/services/journal_two/slot_fill.refresh_params, tests/test_slot_fill_built.py), run over the ONE vector file
// both sides read. A built widget a template places must carry exactly the params the member's own insert and
// refresh write. The expected values are typed by hand in that file.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { builtRefreshParams } from './builtWidgets'

const FILE = path.resolve(__dirname, '../../../../../tests/fixtures/builtRefreshParamsVectors.json')
const VECTORS = JSON.parse(fs.readFileSync(FILE).toString('utf8'))

describe('the shared builtRefreshParams vectors', () => {
  it('reads version 1 with enough cases to mean something', () => {
    expect(VECTORS.version).toBe(1)
    expect(VECTORS.cases.length).toBeGreaterThanOrEqual(6)          // non-vacuity: the loop below passes over []
  })

  for (const c of VECTORS.cases) {
    it(c.name, () => {
      expect(builtRefreshParams(c.old, c.payload)).toEqual(c.expected)
    })
  }
})
