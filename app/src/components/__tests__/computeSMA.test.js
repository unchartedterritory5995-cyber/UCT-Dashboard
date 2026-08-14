import { describe, test, expect } from 'vitest'
import { computeSMA, sanitizeOverlayPeriods } from '../StockChart'

// Reference (slow) implementation — what we're replacing.
// Kept here so the test is self-contained and proves output equivalence.
function referenceSMA(bars, period) {
  const result = []
  for (let i = period - 1; i < bars.length; i++) {
    let sum = 0
    for (let j = i - period + 1; j <= i; j++) sum += bars[j].c
    result.push({ time: bars[i].t, value: sum / period })
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
    expect(result[0].value).toBe(bars[0].c)
    expect(result[9].value).toBe(bars[9].c)
  })

  test('completes SMA200 on 8000 bars fast (O(n) rolling window, not O(n*period))', () => {
    const bars = makeBars(8000)
    // Warm up once so JIT compilation isn't billed to the measured pass.
    computeSMA(bars, 200)
    const t0 = performance.now()
    computeSMA(bars, 200)
    const elapsed = performance.now() - t0
    // Old algo on 8000 bars * 200 period ≈ 1.6M ops ≈ 30-80ms typical.
    // New algo ≈ 8K ops ≈ <2ms typical. The bound is deliberately loose (250ms)
    // — this is a wall-clock assertion on a shared CI worker thread, so it only
    // needs to catch a regression back to the quadratic algorithm (which would
    // land well above it), never to fail from scheduler noise.
    expect(elapsed).toBeLessThan(250)
  })

  test('output matches reference for cent-rounded prices (FP drift regression)', () => {
    // Cent-rounded prices were the empirical trigger for FP drift in the
    // pre-fix rolling-window implementation. This input shape MUST match
    // the reference exactly — any divergence is a correctness bug.
    const bars = []
    for (let i = 0; i < 8000; i++) {
      const raw = 100 + Math.sin(i * 0.07) * 12 + i * 0.005
      // Round to cents — the FP-drift trigger.
      bars.push({ t: 1700000000 + i * 86400, c: Math.round(raw * 100) / 100 })
    }
    const ours = computeSMA(bars, 200)
    const ref  = referenceSMA(bars, 200)
    expect(ours).toEqual(ref)
  })

  test('output matches reference for monotonically rising integer prices', () => {
    // Pure integer arithmetic — any rolling-sum drift would surface immediately.
    const bars = []
    for (let i = 0; i < 1000; i++) {
      bars.push({ t: 1700000000 + i * 86400, c: 100 + i * 0.1 })
    }
    expect(computeSMA(bars, 50)).toEqual(referenceSMA(bars, 50))
  })

  test('returns empty array for empty bars input', () => {
    expect(computeSMA([], 50)).toEqual([])
    expect(computeSMA([], 1)).toEqual([])
  })

  describe('fromStart mode (intraday popup — line begins at first bar)', () => {
    test('emits a value for every bar, starting at bar 0', () => {
      const bars = makeBars(30)
      const result = computeSMA(bars, 9, true)
      expect(result).toHaveLength(30)
      expect(result[0].time).toBe(bars[0].t)
      // First bar = average of just bar 0 (expanding window of size 1).
      expect(result[0].value).toBe(bars[0].c)
    })

    test('leading bars use an expanding window; tail matches the full-window SMA', () => {
      const bars = makeBars(40)
      const period = 9
      const fromStart = computeSMA(bars, period, true)
      const normal = computeSMA(bars, period, false)
      // Once warmed up (i >= period-1), the values must equal the standard SMA.
      const warmed = fromStart.slice(period - 1)
      expect(warmed).toEqual(normal)
    })

    test('returns data even when bars.length < period', () => {
      const bars = makeBars(5)
      const result = computeSMA(bars, 20, true)
      expect(result).toHaveLength(5)
      // bar 2 = average of bars[0..2]
      const expected = (bars[0].c + bars[1].c + bars[2].c) / 3
      expect(result[2].value).toBe(expected)
    })
  })

  // Invalid period = the /charts crash: an MA length edited to 0/blank made
  // `bars[period-1].t` read `.t` off an undefined bar. Must draw nothing, not throw.
  describe('invalid period never crashes (reads .t off undefined bar)', () => {
    const bars = makeBars(300)
    for (const p of [0, -1, -50, NaN, undefined, null, '', 'abc']) {
      test(`period=${JSON.stringify(p)} → [] (no throw)`, () => {
        expect(() => computeSMA(bars, p)).not.toThrow()
        expect(computeSMA(bars, p)).toEqual([])
      })
    }
    test('fractional period floors (1.9 → 1)', () => {
      expect(computeSMA(bars, 1.9)).toEqual(computeSMA(bars, 1))
    })
  })
})

describe('sanitizeOverlayPeriods (persist-boundary guard)', () => {
  const prev = { overlays: [{ type: 'EMA', period: 9 }, { type: 'EMA', period: 20 }] }

  test('reverts an invalid new period to the prior valid one at the same index', () => {
    const next = { overlays: [{ type: 'EMA', period: 9 }, { type: 'EMA', period: 0 }] }
    expect(sanitizeOverlayPeriods(next, prev).overlays[1].period).toBe(20)
  })

  test('falls back to 20 when there is no prior valid value', () => {
    const next = { overlays: [{ type: 'EMA', period: 0 }] }
    expect(sanitizeOverlayPeriods(next, {}).overlays[0].period).toBe(20)
  })

  test.each([0, -1, NaN, undefined, 501, '', 'x'])('coerces bad period %s away from crash range', (bad) => {
    const next = { overlays: [{ type: 'SMA', period: bad }] }
    const out = sanitizeOverlayPeriods(next, {}).overlays[0].period
    expect(Number.isInteger(out) && out >= 1 && out <= 500).toBe(true)
  })

  test('returns the SAME reference when every period is valid (no churn)', () => {
    const next = { overlays: [{ type: 'EMA', period: 9 }, { type: 'SMA', period: 200 }] }
    expect(sanitizeOverlayPeriods(next, prev)).toBe(next)
  })

  test('passes through settings with no overlays untouched', () => {
    const next = { chartType: 'candles' }
    expect(sanitizeOverlayPeriods(next, prev)).toBe(next)
    expect(sanitizeOverlayPeriods(null, prev)).toBe(null)
  })

  test('preserves other overlay fields (color/type) when fixing a period', () => {
    const next = { overlays: [{ type: 'EMA', period: 0, color: '#abc' }] }
    const fixed = sanitizeOverlayPeriods(next, {}).overlays[0]
    expect(fixed).toMatchObject({ type: 'EMA', color: '#abc' })
    expect(fixed.period).toBe(20)
  })
})
