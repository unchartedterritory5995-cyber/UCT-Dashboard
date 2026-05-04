import { describe, test, expect } from 'vitest'
import { computeSMA } from '../StockChart'

// Reference (slow) implementation — what we're replacing.
// Kept here so the test is self-contained and proves output equivalence.
function referenceSMA(bars, period) {
  const result = []
  for (let i = period - 1; i < bars.length; i++) {
    let sum = 0
    for (let j = i - period + 1; j <= i; j++) sum += bars[j].c
    result.push({ time: bars[i].t, value: +(sum / period).toFixed(2) })
  }
  return result
}

function makeBars(n, seed = 1) {
  // Deterministic bars with varied closes — covers edge cases (rising,
  // falling, sideways, volatile) in one fixture.
  const bars = []
  for (let i = 0; i < n; i++) {
    const wave = Math.sin(i * 0.1) * 5
    const drift = i * 0.01
    const noise = ((i * seed) % 7) * 0.3
    bars.push({ t: 1700000000 + i * 86400, c: 100 + wave + drift + noise })
  }
  return bars
}

describe('computeSMA', () => {
  test('output matches reference implementation for SMA50 on 1000 bars', () => {
    const bars = makeBars(1000)
    const ours = computeSMA(bars, 50)
    const ref  = referenceSMA(bars, 50)
    expect(ours).toEqual(ref)
  })

  test('output matches reference implementation for SMA200 on 8000 bars', () => {
    const bars = makeBars(8000, 3)
    const ours = computeSMA(bars, 200)
    const ref  = referenceSMA(bars, 200)
    expect(ours).toEqual(ref)
  })

  test('returns empty array when bars.length < period', () => {
    const bars = makeBars(20)
    expect(computeSMA(bars, 50)).toEqual([])
  })

  test('returns single bar when bars.length === period', () => {
    const bars = makeBars(50)
    const result = computeSMA(bars, 50)
    expect(result).toHaveLength(1)
    expect(result[0].time).toBe(bars[49].t)
  })

  test('handles period=1 (degenerate case = same as close)', () => {
    const bars = makeBars(10)
    const result = computeSMA(bars, 1)
    expect(result).toHaveLength(10)
    expect(result[0].value).toBe(+bars[0].c.toFixed(2))
    expect(result[9].value).toBe(+bars[9].c.toFixed(2))
  })

  test('completes SMA200 on 8000 bars in under 50ms', () => {
    const bars = makeBars(8000)
    const t0 = performance.now()
    computeSMA(bars, 200)
    const elapsed = performance.now() - t0
    // Old algo on 8000 bars * 200 period ≈ 1.6M ops ≈ 30-80ms typical.
    // New algo ≈ 8K ops ≈ <2ms typical. 50ms threshold leaves headroom for slow CI.
    expect(elapsed).toBeLessThan(50)
  })
})
