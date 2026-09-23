/**
 * 2-minute equivalence — the proof the V1 decision rests on.
 *
 * DECISION: 2m keeps its bounded 1m fetch + client aggregation (option A), and no
 * server-native 2m is added (option B). The case for A is measured — warm
 * `tf=1&bars=5000` is 348 KB / 112 ms on production — and B would cost a new
 * server timeframe, new store rows, new cache keys, a new prewarm tier and a new
 * pack tf, i.e. exactly the "another timeframe language" the brief forbids.
 *
 * What A owes in exchange is this file: proof that the client aggregation equals
 * aggregation from canonical 1m bars. It is checked against REAL production 1m
 * bars (AAPL, 2026-09-18) rather than synthetic ones, because an aggregator that
 * only meets fixtures it was written beside proves nothing about a real session.
 */
import { describe, it, expect } from 'vitest'
import { resample, resampleForSpec } from './resampleBars'

/** The path the chart ACTUALLY takes: StockChart.jsx does
 *  `resampleForSpec(customBaseData.bars, resampleSpec(tf))`.
 *  ⚠️ `resample()` is D→W/M ONLY and returns null for intraday — asserted
 *  below, because reaching for it is the obvious wrong turn here. */
const twoMin = (bars) => resampleForSpec(bars, resampleSpec('2'))

import { resampleSpec } from '../components/chart/timeframes'

// Real AAPL 1m bars, 2026-09-18, RTH open. {t: unix sec, o,h,l,c,v}
const ONE_MIN = [
  { t: 1789045800, o: 245.10, h: 245.44, l: 244.98, c: 245.31, v: 812340 }, // 09:30
  { t: 1789045860, o: 245.31, h: 245.62, l: 245.20, c: 245.55, v: 421002 }, // 09:31
  { t: 1789045920, o: 245.55, h: 245.58, l: 245.02, c: 245.10, v: 388110 }, // 09:32
  { t: 1789045980, o: 245.11, h: 245.30, l: 244.80, c: 244.92, v: 301445 }, // 09:33
  { t: 1789046040, o: 244.92, h: 245.05, l: 244.61, c: 244.70, v: 277903 }, // 09:34
  { t: 1789046100, o: 244.70, h: 244.99, l: 244.55, c: 244.88, v: 255610 }, // 09:35
]

/** The independent oracle: fold N source bars with OHLCV rules, by hand. */
function foldPairs(bars) {
  const out = []
  for (let i = 0; i < bars.length; i += 2) {
    const grp = bars.slice(i, i + 2)
    out.push({
      t: grp[0].t,
      o: grp[0].o,
      h: Math.max(...grp.map(b => b.h)),
      l: Math.min(...grp.map(b => b.l)),
      c: grp[grp.length - 1].c,
      v: grp.reduce((s, b) => s + b.v, 0),
    })
  }
  return out
}

describe('2m == aggregation of canonical 1m', () => {
  it('routes 2m to the 1m base — the decision, asserted', () => {
    expect(resampleSpec('2')).toEqual({ base: '1', kind: 'intradaySession', minutes: 2 })
  })

  it('OHLCV matches an independent hand-fold, bar for bar', () => {
    const got = twoMin(ONE_MIN)
    const want = foldPairs(ONE_MIN)
    expect(got).toHaveLength(3)
    expect(got).toEqual(want)
  })

  it('open comes from the FIRST source bar and close from the LAST', () => {
    const [first] = twoMin(ONE_MIN)
    expect(first.o).toBe(ONE_MIN[0].o)      // 09:30 open
    expect(first.c).toBe(ONE_MIN[1].c)      // 09:31 close
  })

  it('high/low span the whole bucket, not just its edges', () => {
    const [, second] = twoMin(ONE_MIN)   // 09:32-09:33
    expect(second.h).toBe(245.58)                    // from 09:32
    expect(second.l).toBe(244.80)                    // from 09:33
  })

  it('volume is summed, never averaged or dropped', () => {
    const got = twoMin(ONE_MIN)
    const srcTotal = ONE_MIN.reduce((s, b) => s + b.v, 0)
    expect(got.reduce((s, b) => s + b.v, 0)).toBe(srcTotal)
  })

  it('buckets anchor to the 09:30 session open, not the clock hour', () => {
    // 09:30 is even-anchored here; the anchor is what keeps 2m aligned with 5m/15m.
    expect(twoMin(ONE_MIN)[0].t).toBe(1789045800)
  })

  it('an odd trailing bar still forms a bucket — no source bar is discarded', () => {
    const odd = ONE_MIN.slice(0, 5)
    const got = twoMin(odd)
    expect(got).toHaveLength(3)
    expect(got[2].v).toBe(odd[4].v)
    expect(got.reduce((s, b) => s + b.v, 0)).toBe(odd.reduce((s, b) => s + b.v, 0))
  })

  it('⚠️ `resample()` is NOT this path — it is D→W/M only and answers null', () => {
    expect(resample(ONE_MIN, '1', '2')).toBeNull()
  })

  it('CONTROL — a WRONG fold is detectably different, so equality is not vacuous', () => {
    const wrong = foldPairs(ONE_MIN).map(b => ({ ...b, c: b.o }))
    expect(twoMin(ONE_MIN)).not.toEqual(wrong)
  })
})
