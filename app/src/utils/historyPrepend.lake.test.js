// Deeper from the lake (2026-11-17): the background depth target and window size where the history lake
// carries a key, and how they sit against the server's numbers and the store's depth caps.
import { describe, it, expect } from 'vitest'
import {
  LAKE_WINDOW_BARS, LAKE_PREFETCH_TARGET_BARS, HIST_PERSIST_MAX_BARS, prefetchTargetBars,
  HISTORY_WINDOW_BARS, HISTORY_PREFETCH_TARGET_BARS,
} from './historyPrepend'
import { DEFAULT_DEPTH_CAPS } from '../data/barStore/registry'

describe('lake depth', () => {
  it('the lake target applies only where the lake carries the key', () => {
    expect(prefetchTargetBars(true)).toBe(LAKE_PREFETCH_TARGET_BARS)
    expect(prefetchTargetBars(false)).toBe(HISTORY_PREFETCH_TARGET_BARS)
  })
  it('deeper and bigger than the server numbers, never past any intraday depth cap', () => {
    expect(LAKE_PREFETCH_TARGET_BARS).toBeGreaterThan(HISTORY_PREFETCH_TARGET_BARS)
    expect(LAKE_WINDOW_BARS).toBeGreaterThan(HISTORY_WINDOW_BARS)
    for (const tf of ['1', '5', '15', '30', '60']) expect(LAKE_PREFETCH_TARGET_BARS).toBeLessThanOrEqual(DEFAULT_DEPTH_CAPS[tf])
  })
  it('the persisted deep segment stays at today\'s background depth', () => {
    expect(HIST_PERSIST_MAX_BARS).toBe(HISTORY_PREFETCH_TARGET_BARS)
  })
  it('the landed chart\'s own background loop uses the lake-aware target (read from the source: one wiring)', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync(new URL('../components/chart/useBarSnapshotBars.js', import.meta.url), 'utf8')
    expect(src).toMatch(/>=\s*prefetchTargetBars\(!!store\.lakeCarries\?\.\(key\)\)\)\s*break/)
    expect(src).not.toMatch(/HISTORY_PREFETCH_TARGET_BARS/)
  })
})
