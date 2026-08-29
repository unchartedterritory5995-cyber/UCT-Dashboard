// app/src/components/chart/builder/toCondition.test.js

import { describe, it, expect } from 'vitest'

import { COMPARISONS, conditionFrom, yieldsCondition, operatorLabel } from './toCondition'
import { TABLE, parseFormula } from '../engine/ast/parse'
import { treeYieldsBool } from '../engine/ast/pine'

describe('the comparison set is DERIVED from the manifest and the engine', () => {
  it('⭐⭐ it finds every comparison and excludes the logical connectives', () => {
    // ⛔ THE MANIFEST CANNOT ANSWER THIS: `>` and `&&` are both binary and both
    // `yields: "bool"`, so a structural read cannot separate them. The split comes
    // from the engine's own arithmetic — a comparison distinguishes MAGNITUDES, a
    // connective sees only zero vs non-zero.
    expect([...COMPARISONS].sort()).toEqual(['!=', '<', '<=', '==', '>', '>='])
    expect(COMPARISONS).not.toContain('&&')
    expect(COMPARISONS).not.toContain('||')
  })

  it('⛔ …and the set really is a subset of what the manifest declares', () => {
    // Non-vacuity in the other direction: a derivation that invented an operator
    // would pass the assertion above if somebody typed it into both places.
    const declared = Object.keys(TABLE.operators)
    for (const op of COMPARISONS) expect(declared).toContain(op)
  })

  it('⚰️ `<` is in the set — the one a single probe would have dropped', () => {
    // ⭐ THE BUG THE DERIVATION NEARLY HAD. `5 < 3` is 0 and `1 < 1` is 0, so
    // probing only the high pair files `<` as a connective and silently removes the
    // most useful operator a member could pick. Both orderings are probed for
    // exactly this, and this case is why.
    expect(COMPARISONS).toContain('<')
    expect(COMPARISONS).toContain('<=')
  })

  it('⛔ every offered operator actually builds something the scan door accepts', () => {
    // ⭐ A ROSTER THAT PROVES ITSELF: each operator is exercised end to end rather
    // than trusted because it appeared in a derivation.
    for (const op of COMPARISONS) {
      const r = conditionFrom('rsi(close, 14)', op, 30)
      expect(r.ok, `${op}: ${r.reason || ''}`).toBe(true)
      expect(yieldsCondition(r.formula), `${op} did not yield a condition`).toBe(true)
    }
  })
})

describe('a numeric column becomes a screen, and is verified rather than assembled', () => {
  it('⭐ the shape a member gets', () => {
    const r = conditionFrom('rsi(close, 14)', '<', 30)
    expect(r.ok).toBe(true)
    expect(r.formula).toBe('(rsi(close, 14)) < 30')
    expect(yieldsCondition(r.formula)).toBe(true)
  })

  it('⛔⛔ the column is PARENTHESISED, so a looser-binding formula cannot reassociate', () => {
    // ⚰️ THE QUIET WRONGNESS THIS REMOVES. `close + 1 < 30` parses as
    // `close + (1 < 30)` in a language where `+` binds tighter than `<` would NOT —
    // but the general risk is real for any formula whose top operator binds looser
    // than the comparison, and a member never sees the difference. Wrapping costs
    // two brackets in the read-back and removes the whole class.
    const r = conditionFrom('close + 1', '<', 30)
    expect(r.ok).toBe(true)
    expect(r.formula).toBe('(close + 1) < 30')
    // and it means what it says: the SUM is compared, not part of it
    const ast = parseFormula(r.formula).ast
    expect(ast.type).toBe('op')
    expect(ast.name).toBe('<')
    expect(ast.args[0].name).toBe('+')
  })

  it('⛔ a non-number threshold refuses, by name', () => {
    for (const bad of ['', '  ', 'thirty', null, undefined, NaN]) {
      const r = conditionFrom('rsi(close, 14)', '<', bad)
      expect(r.ok, JSON.stringify(bad)).toBe(false)
      expect(r.reason).toMatch(/number/)
    }
  })

  it('⛔ an operator outside the derived set refuses and NAMES the set', () => {
    const r = conditionFrom('rsi(close, 14)', '&&', 30)
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/comparison/)
    for (const op of COMPARISONS) expect(r.reason).toContain(op)
  })

  it('⛔ a column that does not read back refuses rather than building on sand', () => {
    const r = conditionFrom('rsi(close, ', '<', 30)
    expect(r.ok).toBe(false)
  })

  it('⭐ negative and fractional thresholds are ordinary', () => {
    expect(conditionFrom('close - open', '>', -1.5).formula).toBe('(close - open) > -1.5')
  })
})

describe('yieldsCondition tells the two kinds apart, which is the whole premise', () => {
  it('⛔⛔ a number is not a screen and a condition is', () => {
    // ⭐ THE NON-VACUITY THAT MATTERS MOST HERE. If this answered the same for both
    // kinds, the affordance would either never appear or appear on every column
    // including the ones that are already screens.
    expect(yieldsCondition('rsi(close, 14)')).toBe(false)
    expect(yieldsCondition('close')).toBe(false)
    expect(yieldsCondition('close > open')).toBe(true)
    expect(yieldsCondition('crossOver(close, sma(close, 50))')).toBe(true)
  })

  it('⛔ it agrees with the engine rather than deciding for itself', () => {
    for (const f of ['rsi(close, 14)', 'close > open', 'sma(close, 20)', 'close != 0']) {
      const p = parseFormula(f)
      expect(yieldsCondition(f)).toBe(!!treeYieldsBool(p.ast))
    }
  })

  it('⛔ garbage is not a condition, and does not throw', () => {
    for (const f of ['', '   ', '((((', 'not a formula', null, undefined]) {
      expect(yieldsCondition(f)).toBe(false)
    }
  })
})

describe('the labels never decide anything', () => {
  it('⭐ an unlabelled operator falls back to its symbol rather than disappearing', () => {
    // ⚠️ A label map that gated the offer would hide a newly-declared comparison
    // until somebody wrote English for it. This one cannot: it is display only.
    expect(operatorLabel('>')).toBe('is above')
    expect(operatorLabel('~=')).toBe('~=')
    for (const op of COMPARISONS) expect(operatorLabel(op)).toBeTruthy()
  })
})
