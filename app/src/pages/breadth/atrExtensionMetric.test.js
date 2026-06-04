import { describe, it, expect } from 'vitest'
import { HM_METRICS, PCTILE_KEYS } from '../Breadth'

// >N×ATR-extended-above-50SMA breadth metric (Jeff Sun extension).
// Validates the heatmap/registry wiring; the count/list math is tested
// backend-side in uct-intelligence/tests/test_breadth_atr_extension.py.
describe('ATR extension breadth metric wiring', () => {
  const byKey = Object.fromEntries(HM_METRICS.filter(m => !m.isHeader).map(m => [m.key, m]))

  it('registers all three bands in the Highs/Lows group with drill-down', () => {
    for (const [key, list] of [
      ['atr_ext_7', 'atr_ext_7_list'],
      ['atr_ext_10', 'atr_ext_10_list'],
      ['atr_ext_12', 'atr_ext_12_list'],
    ]) {
      expect(byKey[key], `${key} missing from HM_METRICS`).toBeTruthy()
      expect(byKey[key].group).toBe('Highs/Lows')
      expect(byKey[key].drillKey).toBe(list)
      expect(byKey[key].polarity).toBe('bull')  // strength gauge
      expect(PCTILE_KEYS.has(key)).toBe(true)   // Views can normalize it
    }
  })

  it('grades the count graduated-green and shows — when absent', () => {
    expect(byKey.atr_ext_10.getFmt({})).toBe('—')
    expect(byKey.atr_ext_10.getTier({ atr_ext_10: null })).toBe('')
    expect(byKey.atr_ext_10.getTier({ atr_ext_10: 5 })).toBe('')     // below g1
    expect(byKey.atr_ext_10.getTier({ atr_ext_10: 20 })).toBe('g1')
    expect(byKey.atr_ext_10.getTier({ atr_ext_10: 40 })).toBe('g2')
    expect(byKey.atr_ext_10.getTier({ atr_ext_10: 70 })).toBe('g3')
    expect(byKey.atr_ext_10.getFmt({ atr_ext_10: 42 })).toBe(42)
  })
})
