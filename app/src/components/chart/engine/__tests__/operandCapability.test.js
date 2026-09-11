import { describe, it, expect } from 'vitest'
import {
  capabilityOf, isChartEvaluable, namesIn, chartEvaluability,
  CHART_SERIES, CHART_CLOCK, SCREENER_SCALARS,
} from '../operandCapability'
import { parseFormula } from '../ast/parse'
import { validateConditionFormula, evaluateCondition, COND_TRUE } from '../conditions'
import { validateInfoFormula, evaluateInfoField } from '../infoFields'

const bars = Array.from({ length: 300 }, (_, i) => ({
  t: 1400000000 + i * 86400, o: 100 + i * 0.1, h: 101 + i * 0.1, l: 99 + i * 0.1, c: 100.5 + i * 0.1, v: 1e6,
}))
const ast = (src) => parseFormula(src).ast

describe('the two execution contexts of ONE vocabulary', () => {
  it('⭐ the table already separates them — 5 series, 13 clock, 137 scalars', () => {
    expect(CHART_SERIES).toEqual(['open', 'high', 'low', 'close', 'volume'])
    expect(CHART_CLOCK).toContain('barindex')
    expect(CHART_CLOCK).toContain('dayofweek')
    expect(SCREENER_SCALARS.length).toBe(137)
    expect(SCREENER_SCALARS).toContain('adr_pct')
  })

  it('⭐ a price series and a clock value run on a chart; a screener scalar does not', () => {
    expect(capabilityOf('close').chart).toBe(true)
    expect(capabilityOf('barindex').chart).toBe(true)
    expect(capabilityOf('sma').chart).toBe(true)
    expect(capabilityOf('adr_pct').chart).toBe(false)
    expect(capabilityOf('rs_rank').chart).toBe(false)
  })

  it('⛔ a screener scalar is still valid IN THE SCREENER — this is a consumer capability', () => {
    const cap = capabilityOf('adr_pct')
    expect(cap.kind).toBe('screenerScalar')
    expect(cap.screener).toBe(true)
    expect(cap.chart).toBe(false)
  })

  it("⭐ a chart binding is the CHART's own extension and the screener has no notion of it", () => {
    const cap = capabilityOf('@legacy:rsi::rsi')
    expect(cap.kind).toBe('binding')
    expect(cap.chart).toBe(true)
    expect(cap.screener).toBe(false)
  })

  it('⛔ the refusal NAMES the column, so a member can act on it', () => {
    const v = chartEvaluability(ast('adr_pct > 5'))
    expect(v.ok).toBe(false)
    expect(v.offenders).toEqual(['adr_pct'])
    expect(v.reason).toContain('adr_pct')
    expect(v.reason).toMatch(/screener/i)
  })

  it('⭐ it names EVERY offender, not just the first', () => {
    const v = chartEvaluability(ast('rs_rank >= 80 && above_50sma && close > open'))
    expect(v.ok).toBe(false)
    expect(v.offenders.sort()).toEqual(['above_50sma', 'rs_rank'])
  })

  it('⭐ a pure-series tree passes', () => {
    expect(chartEvaluability(ast('close > open && high < high[1]')).ok).toBe(true)
    expect(chartEvaluability(ast('sma((high - low) / close, 21) * 100')).ok).toBe(true)
  })

  it('⛔ a scalar rides the `series` NODE TYPE, so only the NAME can tell them apart', () => {
    const scalarTree = ast('adr_pct')
    const seriesTree = ast('close')
    // Same node type — which is exactly why `chartEvaluability` is a name lookup.
    expect(scalarTree.type).toBe(seriesTree.type)
    expect(isChartEvaluable('adr_pct')).toBe(false)
    expect(isChartEvaluable('close')).toBe(true)
  })

  it('⭐ namesIn walks the whole tree including offsets and call arguments', () => {
    // ⚠️ OPERATORS RIDE `.name` TOO (`op` nodes spell themselves `>`, `u-`, `?:`),
    // so the walk returns them as well. That is harmless by construction: only
    // membership in `TABLE.scalars` can make a name an offender, and no operator is
    // in it. Asserting the full set rather than a filtered one keeps the walker
    // honest about what it actually collects.
    expect(namesIn(ast('sma(volume, 30)[2] > adr_pct')).sort())
      .toEqual(['>', 'adr_pct', 'sma', 'volume'].sort())
    expect(chartEvaluability(ast('sma(volume, 30)[2] > adr_pct')).offenders).toEqual(['adr_pct'])
  })
})

describe('⛔⛔ NO SILENT DEAD FORMULAS — the guard at both chart doors', () => {
  it('a CONDITION on a screener scalar is now REFUSED, not accepted-and-always-false', () => {
    const v = validateConditionFormula('adr_pct > 5', {})
    expect(v.ok).toBe(false)
    expect(v.reason).toContain('adr_pct')
  })

  it('…and the refusal reaches the evaluator, so nothing paints', () => {
    const r = evaluateCondition(
      { id: 'c', name: 'x', formula: 'adr_pct > 5', enabled: true, bindings: {}, actions: [] }, bars, null)
    expect(r.column).toBe(null)
    expect(r.error).toContain('adr_pct')
  })

  it('an INFO FIELD on a screener scalar is REFUSED, not rendered as a permanent —', () => {
    const v = validateInfoFormula('adr_pct', {})
    expect(v.ok).toBe(false)
    expect(v.reason).toContain('adr_pct')
    const r = evaluateInfoField(
      { id: 'info:1', label: 'ADR', formula: 'adr_pct', bindings: {}, format: 'number', decimals: 2 }, bars, null)
    expect(r.value).toBe(null)
    expect(r.error).toContain('adr_pct')
  })

  it('⭐ and the legitimate spellings still work — the guard costs nothing real', () => {
    expect(validateConditionFormula('close > open', {}).ok).toBe(true)
    expect(validateInfoFormula('sma((high - low) / close, 21) * 100', {}).ok).toBe(true)
    const r = evaluateCondition(
      { id: 'c2', name: 'y', formula: 'close > open', enabled: true, bindings: {}, actions: [] }, bars, null)
    let t = 0
    for (const v of r.column) if (v === COND_TRUE) t += 1
    expect(t).toBe(300)
  })
})
