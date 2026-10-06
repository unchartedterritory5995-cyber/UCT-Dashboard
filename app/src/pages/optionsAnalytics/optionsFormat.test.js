import { describe, it, expect } from 'vitest'
import { num, fracPct, volPts } from './optionsFormat'

// The retired per-panel helper, verbatim, as the oracle: the shared grammar must
// not move a single options cell.
const OLD_num = (v, d = 2) => (v == null || Number.isNaN(Number(v)) ? '—' : Number(v).toFixed(d))

describe('options panels number grammar', () => {
  it('num() is byte-identical to the toFixed helper it replaced, and never groups', () => {
    for (const v of [0, 1, 1.005, 2.5, -2.5, 12.345, 999.995, 1234.5678, 25000, -0.004, '17.5', null, undefined, 'x']) {
      for (const d of [0, 1, 2, 4]) expect(num(v, d)).toBe(OLD_num(v, d))
    }
    expect(num(1234.5)).toBe('1234.50') // no thousands separator in a strike column
  })

  it('fracPct reads a fraction as a percent; volPts as vol points with no "%"', () => {
    expect(fracPct(0.2534)).toBe('25.3%')
    expect(fracPct(null)).toBe('—')
    expect(volPts(0.2534)).toBe('25.3')
    expect(volPts(-0.01234, 2)).toBe('-1.23')
    expect(volPts(null)).toBe('—')
  })
})
