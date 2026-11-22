// ─── ⭐⭐ RS RATING (2026-11-19) — THE HELD SERIES FOLLOW THE CHART'S LOADED DEPTH ───
//
// ⚰️ CAPTURED on the served e81 build (smoke@, RDDT; the runtime worker's own messages, runs/wprobe-e81-live): the
// chart handed `useSecondarySources` its REQUESTED first-paint depth (600) while the deep backfill grew the loaded rows
// (5m 20,001 → 27,871; 60m 3,000 → 10,363; 30m 19,828), so SP:SPX at the chart's timeframe was held 600 bars deep and
// the daily held rows `heldDepthOf(600, tf)` deep (5m 18, 30m 57, 60m 103: every captured number). The RS line was
// blank on every bar older than the newest 600 SPX bars, and Fred RS's run half refused the whole chart for them.
// These rails hold the ONE rule (`heldSpanFor`), its herd control (a filling chart refetches a few times), the depths
// the fetch then asks, and that the chart feeds the hook the held span, never the requested `barCount` alone.
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { heldSpanFor, HELD_SPAN_LADDER, HELD_SPAN_MAX, ensureChartSources } from './useSecondarySources'
import { heldDepthOf } from './otherSymbols'
import { clearSecondaryBars, secondaryBarsUrl } from './secondaryBars'

afterEach(() => clearSecondaryBars())

describe('heldSpanFor: the chart\'s loaded span, rounded up to a coarse ladder, capped by /api/bars', () => {
  it('first paint: the requested depth stands (a daily chart that asks 5,000 is unchanged)', () => {
    expect(heldSpanFor(0, 600)).toBe(600)
    expect(heldSpanFor(600, 600)).toBe(600)
    expect(heldSpanFor(1407, 5000)).toBe(5000)
    expect(heldSpanFor(0, 0)).toBe(600)
  })

  it('the captured charts: the loaded rows decide, rounded UP to a rung', () => {
    expect(heldSpanFor(27871, 600)).toBe(40000)   // 5m
    expect(heldSpanFor(19828, 600)).toBe(20000)   // 30m
    expect(heldSpanFor(10363, 600)).toBe(20000)   // 60m
    expect(heldSpanFor(3000, 600)).toBe(5000)
  })

  it('⛔ never past /api/bars\'s own ceiling (le=60000): a deeper ask would be a 422, not a deeper answer', () => {
    expect(HELD_SPAN_MAX).toBe(60000)
    expect(heldSpanFor(250000, 600)).toBe(60000)
    expect(heldSpanFor(0, 90000)).toBe(60000)
    const src = fs.readFileSync(path.resolve(process.cwd(), '../api/routers/bars.py'), 'utf8')
    expect(src).toMatch(/bars: int = Query\(default=200, ge=1, le=60000/)
  })

  it('HERD CONTROL: a chart filling from 600 to 28,000 bars, 100 at a time, asks at most one span per rung', () => {
    const spans = new Set()
    for (let loaded = 600; loaded <= 28000; loaded += 100) spans.add(heldSpanFor(loaded, 600))
    expect([...spans]).toEqual([600, 2000, 5000, 10000, 20000, 40000])
    expect(spans.size).toBeLessThanOrEqual(HELD_SPAN_LADDER.length)
  })
})

describe('the fetch reads the one span: the intraday series AND the held daily rows', () => {
  async function urlsFor(keys, tf, span, chartSymbol = null) {
    const asked = []
    const fetcher = (...a) => { asked.push(String(a[0])); return new Promise(() => {}) }
    ensureChartSources(keys, tf, span, fetcher, chartSymbol)
    await Promise.resolve()
    await new Promise((r) => setTimeout(r, 0))
    return asked
  }

  it('a 5m chart filled to 27,871 bars: SP:SPX asked 40,000 deep (not 600), SPX@D and the own daily rows heldDepthOf(40,000)', async () => {
    const span = heldSpanFor(27871, 600)
    const asked = await urlsFor(['SPX', 'SPX@D', 'OWN~D'], '5', span, 'rddt')
    expect(asked).toContain(secondaryBarsUrl('SPX', '5', 40000))
    expect(asked).toContain(secondaryBarsUrl('SPX', 'D', heldDepthOf(40000, '5')))
    expect(asked).toContain(secondaryBarsUrl('RDDT', 'D', heldDepthOf(40000, '5')))
    expect(heldDepthOf(40000, '5')).toBe(523)          // was heldDepthOf(600, '5') = 18 sessions
    expect(asked.some((u) => /bars=600\b/.test(u))).toBe(false)
  })

  it('CONTROL: at first paint the same keys ask the first-paint depths (the rule changes nothing until the chart fills)', async () => {
    const asked = await urlsFor(['SPX', 'SPX@D'], '5', heldSpanFor(0, 600))
    expect(asked).toContain(secondaryBarsUrl('SPX', '5', 600))
    expect(asked).toContain(secondaryBarsUrl('SPX', 'D', heldDepthOf(600, '5')))
  })
})

describe('the chart feeds the hook the held span (StockChart.jsx), code, not prose', () => {
  it('useSecondarySources is handed heldSpanFor(loaded, barCount), and the loaded rows are read from barCountRef', () => {
    const raw = fs.readFileSync(path.resolve(process.cwd(), 'src/components/StockChart.jsx'), 'utf8')
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:"'`])\/\/.*$/gm, '$1')
    const call = code.match(/useSecondarySources\(\s*([\s\S]*?)\)/)
    expect(call, 'the hook call').not.toBeNull()
    const args = call[1].split(',').map((x) => x.trim())
    expect(args[3]).toBe('_heldSpan')
    // ⭐⭐ (2026-11-22) the span starts at the timeframe's full target and only its own rows raise it (`chart/heldSpanPlan.js`)
    expect(code).toMatch(/const _heldSpan = heldSpanOn\(resolvedTf, _heldLoaded\.n, _heldLoaded\.tf, barCount\)/)
    expect(code).toMatch(/const loaded = heldRowsFor\(resolvedTf, barCountRef\.current, heldNewestTRef\.current\)/)
    // CONTROL: the matcher sees the real call (a reverted line, `barCount` 4th, would read here); the 9th argument is
    // the chart's symbol binding (`ownDailyFollowsChartSymbol.test.js`, the e83 live capture)
    expect(args).toHaveLength(10)
    expect(args[8]).toBe('symbolMeta')
    // ⭐⭐ (e91) the 10th is the chart's span of sessions on a rung (`ownDailyDepth.test.js`), counted where the rows are bound
    expect(args[9]).toBe('_heldSessions')
    expect(code).toMatch(/const rung = heldSessionsRung\(heldSessionsRef\.current\)/)
    expect(code).toMatch(/heldSessionsRef\.current = useMemo\(\(\) => sessionsSpanned\(_spanFirstT, _spanLastT\)/)
  })
})
