// ─── ⭐⭐ RS RATING L3 — the JS half of the classification agreement rail ───────────────
//
// `tests/fixtures/ast/symbol_classification_parity.json` is the third party: this file holds
// `bind.js` to it, `tests/test_ast_bind_classification.py` holds `ast_bind.py` to the same rows.
// A pinned expectation goes red when either lane moves, including when both move in step.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { classificationTable, classificationWith, symbolConstantsWith } from './bind'

const FIX = JSON.parse(fs.readFileSync(
  path.resolve(process.cwd(), '..', 'tests/fixtures/ast/symbol_classification_parity.json'), 'utf8'))

describe('L3 classification agreement — JS lane against the pinned fixture', () => {
  it('non-vacuity: every outcome is in the population', () => {
    expect(FIX.cases.length).toBeGreaterThanOrEqual(5)
    expect(FIX.cases.some((c) => c.substituted.length > 0)).toBe(true)
    expect(FIX.cases.some((c) => Object.keys(c.values).length > 0 && c.substituted.length === 0)).toBe(true)
    expect(FIX.cases.some((c) => Object.keys(c.values).length === 0)).toBe(true)
  })
  const table = classificationTable(FIX.table)
  it('the table it serves', () => {
    expect(JSON.parse(JSON.stringify(table))).toEqual(FIX.served)
  })
  for (const c of FIX.cases) {
    it(c.id, () => {
      const r = classificationWith(table, c.symbol)
      expect(r.values).toEqual(c.values)
      expect(r.substituted).toEqual(c.substituted)
      // and the binding carries exactly those values for the classification names
      const consts = symbolConstantsWith({}, c.symbol, null, null, null, table)
      const got = Object.fromEntries(Object.entries(consts).filter(([k]) => /^syminfo\.(industry|sector)$/.test(k)))
      expect(got).toEqual(c.values)
    })
  }
})
