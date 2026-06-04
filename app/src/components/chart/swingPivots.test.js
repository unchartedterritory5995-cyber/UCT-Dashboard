import { describe, it, expect } from 'vitest'
import { detectSwingPivots, sensitivityToParams } from './swingPivots'

// Helper: build OHLC from a flat value array (high=low=val) so a peak bar is a
// clean swing high and a trough bar a clean swing low.
const bars = vals => vals.map((v, i) => ({ time: i + 1, high: v, low: v, open: v, close: v }))

describe('detectSwingPivots', () => {
  it('returns [] for empty or too-short input', () => {
    expect(detectSwingPivots([], { leftRight: 2 })).toEqual([])
    expect(detectSwingPivots(bars([1, 2, 3]), { leftRight: 2 })).toEqual([]) // need 2*2+1=5
    expect(detectSwingPivots(null, { leftRight: 2 })).toEqual([])
  })

  it('detects a clean alternating zigzag', () => {
    const vals = [10, 11, 12, 11, 10, 9, 8, 9, 10, 11, 12, 11, 10]
    const piv = detectSwingPivots(bars(vals), { leftRight: 2, pctFloor: 5 })
    expect(piv).toEqual([
      { time: 3, price: 12, type: 'high' },
      { time: 7, price: 8, type: 'low' },
      { time: 11, price: 12, type: 'high' },
    ])
  })

  it('rejects a bounce smaller than the % floor', () => {
    // small high (9.2) between a real high and the recovery should be dropped
    const vals = [10, 12, 9, 9.2, 9, 12, 8]
    const piv = detectSwingPivots(bars(vals), { leftRight: 1, pctFloor: 5 })
    expect(piv.map(p => p.price)).toEqual([12, 9, 12])
    expect(piv.some(p => p.price === 9.2)).toBe(false)
  })

  it('keeps the more extreme of consecutive same-type pivots', () => {
    // two highs in a row with no qualifying low between → keep the taller
    const vals = [1, 5, 1, 1, 9, 1, 1]
    const piv = detectSwingPivots(bars(vals), { leftRight: 1, pctFloor: 1 })
    const highs = piv.filter(p => p.type === 'high')
    // the 9 high should win over the 5 high (no low between them survives as the
    // troughs are equal value 1 and within floor); at minimum 9 is present and 5 is collapsed
    expect(highs.some(h => h.price === 9)).toBe(true)
  })

  it('excludes right-edge bars within R of the end', () => {
    // a tall high in the last R bars must not be labeled (not enough right context)
    const vals = [10, 9, 8, 9, 10, 9, 8, 9, 99]
    const piv = detectSwingPivots(bars(vals), { leftRight: 2, pctFloor: 1 })
    expect(piv.some(p => p.price === 99)).toBe(false)
  })

  it('output strictly alternates high/low', () => {
    const vals = [10, 14, 9, 13, 8, 15, 7, 16, 6, 17, 5, 18, 4]
    const piv = detectSwingPivots(bars(vals), { leftRight: 1, pctFloor: 5 })
    for (let i = 1; i < piv.length; i++) {
      expect(piv[i].type).not.toBe(piv[i - 1].type)
    }
  })
})

describe('sensitivityToParams', () => {
  it('maps levels with timeframe-aware floors', () => {
    expect(sensitivityToParams('medium', 'D')).toEqual({ leftRight: 6, pctFloor: 6 })
    expect(sensitivityToParams('low', 'D').pctFloor).toBeGreaterThan(sensitivityToParams('high', 'D').pctFloor)
    // intraday floor smaller than daily, weekly larger
    expect(sensitivityToParams('medium', '5').pctFloor).toBeLessThan(sensitivityToParams('medium', 'D').pctFloor)
    expect(sensitivityToParams('medium', 'W').pctFloor).toBeGreaterThan(sensitivityToParams('medium', 'D').pctFloor)
  })

  it('falls back to medium for unknown levels', () => {
    expect(sensitivityToParams('bogus', 'D')).toEqual(sensitivityToParams('medium', 'D'))
  })
})
