/**
 * ⚡ THE CHART'S SMA / EMA TAKE THE COLUMN PATH (section 3.3 change 5 / Phase E4, 2026-11-28): the Moving Average
 * definition's SMA and EMA never build `{value}` points (`smaOfSeries` / `emaOfSeries` are not called), so a compute
 * allocates no object per bar. Red before the change (movingAverage called the point functions). The values are railed
 * in movingAverages.columns.test.js; this file only watches which path runs (a module mock is per file).
 */
import { describe, it, expect, vi } from 'vitest'

const calls = vi.hoisted(() => ({ sma: 0, ema: 0, smaCol: 0, emaCol: 0 }))
vi.mock('./movingAverages', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    smaOfSeries: (...a) => { calls.sma++; return real.smaOfSeries(...a) },
    emaOfSeries: (...a) => { calls.ema++; return real.emaOfSeries(...a) },
    smaColumn: (...a) => { calls.smaCol++; return real.smaColumn(...a) },
    emaColumn: (...a) => { calls.emaCol++; return real.emaColumn(...a) },
  }
})
const registry = await import('./engine/nativeRegistry')

describe('the Moving Average definition', () => {
  it('computes SMA and EMA without building a point per bar', () => {
    const def = registry.getDefinition('movingAverage')
    const bars = Array.from({ length: 3000 }, (_, i) => ({ t: 1_700_000_000 + i * 86400, o: 10, h: 11, l: 9, c: 10 + (i % 7), v: 1 }))
    const source = Float64Array.from(bars.map((b) => b.c))
    for (const maType of [undefined, 'sma', 'ema']) registry.computeFor(def, bars, { period: 20, ...(maType ? { maType } : {}) }, { source })
    expect({ sma: calls.sma, ema: calls.ema }).toEqual({ sma: 0, ema: 0 })
    expect(calls.smaCol).toBe(2)
    expect(calls.emaCol).toBe(1)
  })
})
