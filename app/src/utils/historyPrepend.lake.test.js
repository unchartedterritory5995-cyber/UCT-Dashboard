/* global process */
// Deeper from the lake (2026-11-17): the background depth target and window size where the history lake
// carries a key, and how they sit against the server's numbers and the store's depth caps.
import { describe, it, expect } from 'vitest'
import {
  LAKE_WINDOW_BARS, LAKE_PREFETCH_TARGET_BARS, HIST_PERSIST_MAX_BARS, prefetchTargetBars,
  HISTORY_WINDOW_BARS, HISTORY_PREFETCH_TARGET_BARS, lakeTargetBars, LAKE_TARGET_BARS_BY_TF,
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
    const { join } = await import('node:path')
    // (vitest runs from app/; this environment's import.meta.url is not a file: URL)
    const src = readFileSync(join(process.cwd(), 'src', 'components', 'chart', 'useBarSnapshotBars.js'), 'utf8')
    expect(src).toMatch(/>=\s*prefetchTargetBars\(!!store\.lakeCarries\?\.\(key\), parseKey\(key\)\?\.tf\)\)\s*break/)
    expect(src).not.toMatch(/HISTORY_PREFETCH_TARGET_BARS/)
  })
  // 2026-11-18: hourly and 30-minute load zoomed-all-the-way-out deep in the ONE lake load.
  it('60m and 30m go deeper than the other intraday timeframes, each under its own depth cap', () => {
    expect(lakeTargetBars('60')).toBeGreaterThanOrEqual(45000)   // ~15 years of 60m store bars
    expect(lakeTargetBars('30')).toBeGreaterThanOrEqual(35000)   // ~6 years of 30m store bars
    for (const tf of ['1', '5', '15']) expect(lakeTargetBars(tf)).toBe(LAKE_PREFETCH_TARGET_BARS)
    expect(lakeTargetBars(undefined)).toBe(LAKE_PREFETCH_TARGET_BARS)
    for (const tf of ['1', '5', '15', '30', '60']) expect(lakeTargetBars(tf)).toBeLessThanOrEqual(DEFAULT_DEPTH_CAPS[tf])
    expect(prefetchTargetBars(true, '60')).toBe(LAKE_TARGET_BARS_BY_TF['60'])
    expect(prefetchTargetBars(false, '60')).toBe(HISTORY_PREFETCH_TARGET_BARS)
  })
  it('every reader of the lake depth asks it per timeframe (read from the source: one wiring)', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const rd = (...p) => readFileSync(join(process.cwd(), 'src', ...p), 'utf8')
    const net = rd('data', 'barStore', 'network.js')
    expect(net).not.toMatch(/LAKE_PREFETCH_TARGET_BARS/)
    expect((net.match(/lakeTargetBars\(parseKey\(key\)\?\.tf\)/g) || []).length).toBe(2)
    expect(rd('data', 'barStore', 'historyFeed.js')).toMatch(/lakeTargetBars\(ls\.tf\)/)
    expect(rd('data', 'barStore', 'prefetch.js')).toMatch(/prefetchTargetBars\(lakeCarries, parseKey\(k\)\?\.tf\)/)
  })
})
