import { describe, it, expect } from 'vitest'
import { HM_METRICS, PCTILE_KEYS } from '../Breadth'

// >N×ATR-extended-above-50SMA breadth metric (Jeff Sun extension).
// Validates the heatmap/registry wiring; the count/list math is tested
// backend-side in uct-intelligence/tests/test_breadth_atr_extension.py.
describe('ATR extension breadth metric wiring', () => {
  const byKey = Object.fromEntries(HM_METRICS.filter(m => !m.isHeader).map(m => [m.key, m]))

  it('registers the single 7× band in the Highs/Lows group with drill-down', () => {
    for (const [key, list] of [
      ['atr_ext_7', 'atr_ext_7_list'],
    ]) {
      expect(byKey[key], `${key} missing from HM_METRICS`).toBeTruthy()
      expect(byKey[key].group).toBe('Highs/Lows')
      expect(byKey[key].drillKey).toBe(list)
      expect(byKey[key].polarity).toBe('bull')  // strength gauge
      expect(PCTILE_KEYS.has(key)).toBe(true)   // Views can normalize it
    }
  })

  it('no longer registers the retired 10× / 12× bands', () => {
    expect(byKey.atr_ext_10).toBeUndefined()
    expect(byKey.atr_ext_12).toBeUndefined()
    expect(PCTILE_KEYS.has('atr_ext_10')).toBe(false)
    expect(PCTILE_KEYS.has('atr_ext_12')).toBe(false)
  })

  it('grades the count graduated-green and shows — when absent', () => {
    expect(byKey.atr_ext_7.getFmt({})).toBe('—')
    expect(byKey.atr_ext_7.getTier({ atr_ext_7: null })).toBe('')
    expect(byKey.atr_ext_7.getTier({ atr_ext_7: 10 })).toBe('')     // below g1
    expect(byKey.atr_ext_7.getTier({ atr_ext_7: 20 })).toBe('g1')
    expect(byKey.atr_ext_7.getTier({ atr_ext_7: 40 })).toBe('g2')
    expect(byKey.atr_ext_7.getTier({ atr_ext_7: 60 })).toBe('g3')
    expect(byKey.atr_ext_7.getFmt({ atr_ext_7: 9 })).toBe(9)
  })
})
