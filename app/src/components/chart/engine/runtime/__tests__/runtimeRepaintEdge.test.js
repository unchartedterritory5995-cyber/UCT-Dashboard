// app/src/components/chart/engine/runtime/runtimeRepaintEdge.test.js
//
// ─── ⭐⭐ RT2 — WHICH CLOCK LEAVES MOVE ON A CLOSED BAR, MEASURED BY MOVING THE FETCH ─
//
// `runtimeRepaint.json::clockEdge` says a handful of clock leaves reach PAST
// their own bar. That is a claim about `indicators.js::computeClock`, the one
// producer of every clock column both lanes read, so it is proved against it:
// compute the clock over N bars, then over N+1 and N+2 (a later bar arrives), and
// over N with the newest bar forming against closed (the newest bar closes). A
// leaf whose value on a CLOSED bar (index < N-1) changes is a leaf whose value
// depends on a later bar.
//
//   · the set of leaves that move is EXACTLY `clockEdge`'s keys — no more (a
//     stable leaf branded repainting) and no fewer (a moving leaf called stable);
//   · a leaf declared `1` stops moving once one later bar exists; a leaf declared
//     `unbounded` moves again on the next bar.
//
// ⛔ THE HOST TABLE SAYS `lookback: 0` AND NO `forward` FOR EVERY ONE OF THEM —
// this rail is the evidence for the finding the RT2 triage section hands the
// integrator, and the control below proves the instrument can say "stable".

import { describe, it, expect } from 'vitest'
import { computeClock, CLOCK_COLUMNS } from '../../../indicators.js'
import { RUNTIME_REPAINT_RULES, clockLeafReach } from '../runtimeRepaint'
import { TABLE } from '../../ast/parse'
import { UNBOUNDED } from '../../ast/lint'

const DAY = 86400
const noonDow = (t) => new Date((t + 12 * 3600) * 1000).getUTCDay()
const noonYear = (t) => new Date((t + 12 * 3600) * 1000).getUTCFullYear()
const bar = (t, i) => ({ t, o: 10, h: 11, l: 9, c: 10 + i, v: 100 })

/** Weekday daily bars stamped at ET midnight (05:00 UTC in EST) from
 *  2025-12-01, with N at the first bar of 2026: the bar that arrives at N is a
 *  new YEAR, MONTH and DAY, so every calendar half of the right edge moves. */
function dailyAcrossYear() {
  const bars = []
  let t = Date.UTC(2025, 11, 1, 5) / 1000
  while (bars.length < 40) {
    if (noonDow(t) !== 0 && noonDow(t) !== 6) bars.push(bar(t, bars.length))
    t += DAY
  }
  return { bars, N: bars.findIndex((b) => noonYear(b.t) === 2026) }
}

/** 5-minute bars from 2026-09-08 22:00 ET, with N at 00:00 ET the next day:
 *  the bar that arrives at N is a new DAY, HOUR and MINUTE. */
function intradayAcrossMidnight() {
  const t0 = Date.UTC(2026, 8, 9, 2) / 1000
  const bars = Array.from({ length: 40 }, (_, i) => bar(t0 + i * 300, i))
  return { bars, N: 24 }
}

const same = (a, b) => (Number.isNaN(a) && Number.isNaN(b)) || a === b

/** Leaves whose value on a bar < `upto` differs between two clock maps. */
function moved(x, y, upto) {
  const out = new Set()
  for (const name of CLOCK_COLUMNS) {
    for (let i = 0; i < upto; i += 1) {
      if (!same(x[name][i], y[name][i])) { out.add(name); break }
    }
  }
  return out
}

const EDGE = Object.fromEntries(Object.entries(RUNTIME_REPAINT_RULES.clockEdge).filter(([k]) => !k.startsWith('_')))

const FIXTURES = [['daily, across a year end', dailyAcrossYear(), '1D'],
  ['5-minute, across midnight', intradayAcrossMidnight(), '5']]

/** Every leaf that moves on a CLOSED bar when the fetch grows or its newest bar
 *  closes. A closed fetch: all N of its bars are closed; a forming one: N-1. */
function movedOn({ bars, N }, tf) {
  const at = (n, forming) => computeClock(bars.slice(0, n), tf, forming)
  return new Set([
    ...moved(at(N, false), at(N + 1, false), N),
    ...moved(at(N, false), at(N + 1, true), N),
    ...moved(at(N, true), at(N, false), N - 1),
  ])
}

describe('RT2 — the right edge, measured by moving the fetch', () => {
  it.each(FIXTURES)('⛔ %s: every leaf that moves on a closed bar is declared in `clockEdge`', (_, fx, tf) => {
    expect(fx.N).toBeGreaterThan(5)
    const undeclared = [...movedOn(fx, tf)].filter((leaf) => !Object.prototype.hasOwnProperty.call(EDGE, leaf))
    expect(undeclared).toEqual([])
  })

  it('and no declared leaf is stable: across the two fetches, the moving set IS `clockEdge`', () => {
    const all = new Set(FIXTURES.flatMap(([, fx, tf]) => [...movedOn(fx, tf)]))
    expect([...all].sort()).toEqual(Object.keys(EDGE).sort())
  })

  it.each(FIXTURES)('%s: a leaf declared `1` is final once one later bar exists', (_, { bars, N }, tf) => {
    const one = computeClock(bars.slice(0, N + 1), tf, false)
    const two = computeClock(bars.slice(0, N + 2), tf, false)
    const still = moved(one, two, N)
    for (const [leaf, reach] of Object.entries(EDGE)) {
      if (reach !== UNBOUNDED) {
        expect(reach, leaf).toBe(1)
        expect(still.has(leaf), leaf).toBe(false)
      }
    }
    // ...while the bar-position leaves keep moving with every bar
    expect(still.has('lastbarindex')).toBe(true)
    expect(still.has('lastbartime')).toBe(true)
  })

  it.each(FIXTURES)('⭐ CONTROL, %s: the instrument says "stable" — `isconfirmed` and `barindex` do not move', (_, fx, tf) => {
    const all = movedOn(fx, tf)
    expect(all.has('isconfirmed')).toBe(false)
    expect(all.has('barindex')).toBe(false)
    expect(all.size).toBeGreaterThan(0)
  })
})

describe('RT2 — the finding, stated as a rail', () => {
  it('the shared table declares no forward window on any right-edge leaf (so the host says 0)', () => {
    for (const leaf of Object.keys(EDGE)) {
      const spec = TABLE.clock[leaf]
      expect(spec, leaf).toBeTruthy()
      expect(Object.prototype.hasOwnProperty.call(spec, 'forward'), leaf).toBe(false)
      expect(clockLeafReach(leaf), leaf).toBe(EDGE[leaf])
    }
  })
})
