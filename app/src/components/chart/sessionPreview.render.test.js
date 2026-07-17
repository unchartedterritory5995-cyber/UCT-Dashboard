import { describe, it, expect } from 'vitest'
import { applySessionCandle } from './sessionPreview'
import { barsRenderPlan } from './renderPlan'

// Contract between the two modules StockChart.updateChart composes, written after
// the 2026-07-16 "Include pre/post-market does nothing" bug: applySessionCandle
// builds the bars that get PAINTED (displayBars), while barsRenderPlan decides
// whether to setData at all. The plan was measured against filteredBars — the pure
// regular-session bars, which the session candle deliberately never touches — so it
// reported 'noop' and the paint was skipped. The candle was computed, then thrown away.
//
// LOCKED: the render plan MUST be measured against the session-APPLIED bars.
//
// SCOPE — read before trusting this file: these are the two PURE modules only. They
// pin the contract (a session-applied change MUST read as a repaint; unchanged RTH
// bars MUST read as 'noop') and show why the old wiring could never paint. They do
// NOT execute StockChart.updateChart, so they would still pass if someone re-wired
// barsRenderPlan back to filteredBars. That wiring is guarded by the comment at the
// `_plan` declaration in StockChart.jsx; verifying it end-to-end needs a live
// pre/post-market session on a chart in the /charts workspace.

const RTH = [
  { t: '2026-07-15', o: 10, h: 11, l: 9.5, c: 10.5, v: 1000 },
  { t: '2026-07-16', o: 10.5, h: 12, l: 10.2, c: 11.8, v: 2000 },
]

describe('session candle → render plan (the seam that broke)', () => {
  it('pre-market: an APPENDED preview candle must force a repaint', () => {
    const applied = applySessionCandle(RTH, {
      curTime: '2026-07-17',                                        // new day, pre-market
      extAgg: { open: 11.9, high: 12.4, low: 11.7, close: 12.2, volume: 300 },
      extPrice: 12.2,
    })
    expect(applied).toHaveLength(RTH.length + 1)                    // candle was built
    expect(applied[applied.length - 1].t).toBe('2026-07-17')

    // The fix: plan against the painted bars → a real paint happens.
    expect(barsRenderPlan(RTH, applied).mode).toBe('full')

    // The bug: plan against filteredBars (unchanged by design) → skipped forever.
    expect(barsRenderPlan(RTH, RTH).mode).toBe('noop')
  })

  it('post-market: an EXTENDED last candle must force a repaint', () => {
    const applied = applySessionCandle(RTH, {
      curTime: '2026-07-16',                                        // same day, post-market
      extAgg: { open: 11.8, high: 12.9, low: 11.75, close: 12.6, volume: 500 },
      extPrice: 12.6,
    })
    expect(applied).toHaveLength(RTH.length)                        // extended, not appended
    expect(applied[applied.length - 1].c).toBe(12.6)

    // Same length + same last timestamp + changed OHLC = the developing-bar case.
    expect(barsRenderPlan(RTH, applied).mode).toBe('incremental')
    expect(barsRenderPlan(RTH, RTH).mode).toBe('noop')
  })

  it('a live ext-price tick keeps repainting the extended candle', () => {
    const mk = (px) => applySessionCandle(RTH, {
      curTime: '2026-07-16',
      extAgg: { open: 11.8, high: 12.9, low: 11.75, close: px, volume: 500 },
      extPrice: px,
    })
    // Tick to a new price → must still reach the series, not be read as 'noop'.
    expect(barsRenderPlan(mk(12.6), mk(12.7)).mode).toBe('incremental')
    // Identical tick → correctly stays a no-op (this is what the guard is FOR:
    // it stops the ~1/sec price-tag recompute from wiping the live bar).
    expect(barsRenderPlan(mk(12.6), mk(12.6)).mode).toBe('noop')
  })

  // The 2026-07-17 follow-up: the candle appeared instantly at the live price, then
  // grew its body + wicks ~1s later on every ticker open. Cause is right here — the
  // live ext price lands from a warm cache while the aggregate is a per-symbol fetch,
  // and a price with no aggregate has no range to draw. StockChart now waits for
  // useSessionExtBars' `ready` before applying the candle at all.
  it('price-only (aggregate still loading) collapses to a flat doji, then morphs', () => {
    const priceOnly = applySessionCandle(RTH, {
      curTime: '2026-07-17', extAgg: null, extPrice: 12.2,
    })
    const doji = priceOnly[priceOnly.length - 1]
    expect([doji.o, doji.h, doji.l, doji.c]).toEqual([12.2, 12.2, 12.2, 12.2])  // no body, no wicks
    expect(doji.v).toBe(0)

    const full = applySessionCandle(RTH, {
      curTime: '2026-07-17',
      extAgg: { open: 11.9, high: 12.4, low: 11.7, close: 12.2, volume: 300 },
      extPrice: 12.2,
    })
    // Same bar, same timestamp, different OHLC — the user-visible fill-in.
    expect(barsRenderPlan(priceOnly, full).mode).toBe('incremental')
    expect(full[full.length - 1].o).toBe(11.9)
  })

  it('regular hours / intraday: displayBars IS filteredBars, so the guard still holds', () => {
    // sessionCandleActive false → applySessionCandle is a pass-through (same ref),
    // so planning off displayBars is byte-identical to the old filteredBars behavior.
    const applied = applySessionCandle(RTH, { curTime: '2026-07-16', extAgg: null, extPrice: null })
    expect(applied).toBe(RTH)
    expect(barsRenderPlan(RTH, applied).mode).toBe('noop')
  })
})
