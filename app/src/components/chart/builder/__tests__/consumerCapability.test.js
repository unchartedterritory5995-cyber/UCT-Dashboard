import { describe, it, expect } from 'vitest'
import { startersFor } from '../starterCapability'
import { STARTER_LIST } from '../StarterLibrary'
import { vocabulary } from '../criteria'
import { TABLE } from '../../engine/ast/parse'
import { chartOnlyTable, HIDDEN_SCALAR_COUNT } from '../../engine/operandCapability'

describe('the picker vocabulary, per execution context', () => {
  it('⭐ the screener keeps all 137 scalars — this is a consumer capability, not a verdict', () => {
    const full = vocabulary(TABLE)
    expect(full.scalars.size).toBe(HIDDEN_SCALAR_COUNT)
    expect(full.scalars.has('adr_pct')).toBe(true)
  })

  it('⛔ a CHART vocabulary offers no screener scalars at all', () => {
    const chart = vocabulary(chartOnlyTable(TABLE))
    expect(chart.scalars.size).toBe(0)
    expect([...chart.series]).toEqual(['open', 'high', 'low', 'close', 'volume'])
  })

  it('⭐ and it loses NOTHING else — same functions, comparators and crossings', () => {
    const full = vocabulary(TABLE)
    const chart = vocabulary(chartOnlyTable(TABLE))
    expect(chart.functions.size).toBe(full.functions.size)
    expect([...chart.comparators]).toEqual([...full.comparators])
    expect([...chart.crossings.keys()]).toEqual([...full.crossings.keys()])
  })

  it('⛔ the substitution does not mutate the shipped table', () => {
    chartOnlyTable(TABLE)
    expect(Object.keys(TABLE.scalars).length).toBe(HIDDEN_SCALAR_COUNT)
  })

  it('⭐ the two vocabularies coexist — the cache is keyed by table identity', () => {
    const a = vocabulary(TABLE)
    const b = vocabulary(chartOnlyTable(TABLE))
    expect(a).not.toBe(b)
    expect(vocabulary(TABLE)).toBe(a)
    expect(vocabulary(chartOnlyTable(TABLE))).toBe(b)
  })
})

describe('starter capability — measured against the 8 shipped starters', () => {
  it('⚠️ ALL EIGHT are boolean, and only ONE is chart-evaluable', () => {
    expect(STARTER_LIST.length).toBe(8)
    expect(STARTER_LIST.every((e) => e.resultType === 'boolean')).toBe(true)
    const runnable = STARTER_LIST.filter((e) => e.chartEvaluable)
    expect(runnable.map((e) => e.setup)).toEqual(['Oops Reversal'])
  })

  it('⛔ CONDITION mode offers only the chart-evaluable boolean one', () => {
    expect(startersFor('condition', STARTER_LIST).map((e) => e.setup)).toEqual(['Oops Reversal'])
  })

  it('⛔ INFO VALUE mode offers none of them — every one answers true/false', () => {
    expect(startersFor('infoValue', STARTER_LIST)).toEqual([])
  })

  it('⛔ INDICATOR is NOT chart-only — it keeps all eight, because it also feeds the screener', () => {
    // A definition authored in this sheet is a USER DEFINITION: the chart draws it
    // and the SCREENER scans on it, from this same sheet (`ScreensManager` mounts
    // it too). All eight shipped starters are screener setups, so filtering them
    // here would empty the Library on the surface it was built for.
    expect(startersFor('indicator', STARTER_LIST).length).toBe(8)
  })

  it('⭐ the SCREENER still gets all eight — nothing was removed from the catalogue', () => {
    expect(startersFor('scan', STARTER_LIST).length).toBe(8)
    expect(startersFor(null, STARTER_LIST).length).toBe(8)
  })

  it('⭐ every blocked starter NAMES the columns that block it', () => {
    for (const e of STARTER_LIST.filter((x) => !x.chartEvaluable)) {
      expect(Array.isArray(e.blockedBy)).toBe(true)
      expect(e.blockedBy.length).toBeGreaterThan(0)
    }
  })

  it('⛔ a numeric chart-evaluable starter reaches INFO VALUE and INDICATOR, not CONDITION', () => {
    const fake = [{ setup: 'ADR 21', resultType: 'numeric', chartEvaluable: true }]
    expect(startersFor('infoValue', fake).map((e) => e.setup)).toEqual(['ADR 21'])
    expect(startersFor('condition', fake)).toEqual([])
  })
})
