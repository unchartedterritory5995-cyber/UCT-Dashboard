// app/src/components/chart/engine/runtime/__tests__/twoVendorParity.test.js
//
// ─── TWO MORE INDICATORS, AGAINST TRADINGVIEW'S OWN NUMBERS ────────────────
//
// The third vendor rail, beside `fvgVendorParity`. It settles the two findings
// the first capture left open — `liquidity-pools` and `trendlines` — WITHOUT a
// browser, because the vendor's side is pinned: TradingView's output does not
// change when ours does, so re-running our engine against the stored capture is
// a real comparison and not a re-render of our own work.
//
// ⛔ THE CAPTURE'S OWN LIMITS ARE HONOURED. `liquidity-pools` was transported as
// COUNTS ONLY (`_geometryNotCaptured`), so this file compares counts and the
// DATE WINDOW and says so — it does not imply a geometric match nobody made.
// `trendlines` carries full geometry, so it is compared coordinate by
// coordinate.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { buildObjectLane, runObjectLane } from '../objectLane.js'
import { toRenderState } from '../../objectRenderState.js'
import { OBJECT_STATUS } from '../../objectRuntime.js'

const REPO = path.resolve(process.cwd(), '..')
const V = JSON.parse(fs.readFileSync(
  path.join(REPO, 'tests/fixtures/vendor/visual/five-indicators-spy-1d-2026-09-23.json'), 'utf8'))

// ⭐ THE VENDOR READ 300 BARS, SO THIS READS 300. Counting our objects over a
// longer history and comparing to their shorter one would make us look
// systematically busier than the vendor — at 600 bars this script produces
// almost exactly double everything, which is the agreement, not a divergence.
const N = 300

// ⛔⛔ AND `trendlines` NEEDS MORE HISTORY THAN THE VENDOR'S CAPTURED WINDOW.
// It runs `pivothigh(high, 100, 15)`, so no pivot can form until 115 bars in:
// over 300 bars only the last two of TradingView's five lines are reachable at
// all, and comparing five against two would report three phantom misses. The
// vendor's CHART had far more than 300 bars loaded — 300 is what was
// transported, not what it computed from. ⭐ So the counts question is asked at
// the captured window and the geometry question at a depth that can answer it,
// and each case says which it used.
const DEEP = 600

const FIX = JSON.parse(fs.readFileSync(
  path.join(REPO, 'tests/fixtures/vendor/spy-1d-bars-3000-2026-09-13.json'), 'utf8'))
const dateOf = (s) => new Date(s * 1000).toISOString().slice(0, 10)

const barsOf = (n) => FIX.bars.slice(-n).map((b) => ({
  t: Math.floor(Date.parse(`${b.t}T00:00:00Z`) / 1000),
  o: b.o, h: b.h, l: b.l, c: b.c, v: b.v,
}))

function runScript(rel, n = N) {
  const bars = barsOf(n)
  const series = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(bars.map((b) => b[k])))
  const src = fs.readFileSync(path.join(REPO, rel), 'utf8')
  const lane = buildObjectLane(src, { tf: 'D', newestBarIsForming: false, bars })
  expect(lane.ok, lane.ok ? '' : `refused ${JSON.stringify(lane.refusal)}`).toBe(true)
  const run = runObjectLane(lane, {
    bars: bars.length, series, confirmed: true, readTime: (i) => bars[i].t,
  })
  return { run, st: toRenderState(run.live || [], { bars }) }
}

describe('⭐⭐ Liquidity Pools, against TradingView\'s own counts', () => {
  const LP = V.scripts['liquidity-pools']

  it('⛔ CONTROL — the capture is real, and states what it did NOT transport', () => {
    expect(LP.counts).toEqual({ lines: 90, labels: 45 })
    expect(String(LP._geometryNotCaptured)).toMatch(/COUNTS ONLY/)
    // ⛔ the window the verdict turns on
    expect(String(LP._verdict)).toMatch(/2025-07\.\.2026-09/)
  })

  it('⭐⭐ THE RUN COMPLETES — this is the whole defect, and it was not the line cap', () => {
    // ⚰️ It used to REFUSE at bar 250: "more than 500 live linefill objects",
    // then stop stepping, so nothing after 2025-04-15 was ever drawn on a series
    // reaching 2026-09-11. `PARITY-ROOT-CAUSE.md` read that as the line-cap
    // defect RC-B fixed. It was not: this script declares `max_lines_count=500`
    // and never had more than 86 lines live. The envelope that fired was
    // `linefill`, for which Pine publishes no limit at all.
    const { run } = runScript('corpus/committed/liquidity-pools__fa7b28e733.pine')
    expect(run.status, `the run refused: ${run.reason}`).toBe(OBJECT_STATUS.OK)
  })

  it('⭐⭐ and what we draw is IN THE VENDOR\'S WINDOW — zero overlap before', () => {
    const { run, st } = runScript('corpus/committed/liquidity-pools__fa7b28e733.pine')
    const xs = (st.lines || []).flatMap((l) => [l.x1, l.x2]).filter(Number.isFinite)
    expect(xs.length, 'no line coordinates at all — nothing was compared').toBeGreaterThan(0)
    const newest = dateOf(Math.max(...xs))
    // ⚰️ THE MEASUREMENT THAT NAMED THIS DEFECT: our newest surviving line was
    // 2025-04-09 against a vendor window running into 2026-09. Zero overlap.
    expect(newest >= '2026-09-01', `our newest line is ${newest} — still stale`).toBe(true)

    const live = run.live || []
    const lines = live.filter((o) => o.family === 'line').length
    const labels = live.filter((o) => o.family === 'label').length

    // ⭐ FOUR LINES AND TWO LABELS SHORT, AND THE SHORTFALL IS EXPLAINED RATHER
    // THAN TOLERATED. Our bar fixture ends 2026-09-13; the vendor captured to
    // 2026-09-22 — nine further sessions, in which this script forms two more
    // pools. Two pools are exactly 4 lines and 2 labels, which is the whole gap.
    // ⛔ Asserting equality would therefore be asserting that our bars run nine
    // sessions longer than they do.
    expect(LP.counts.lines - lines).toBeLessThanOrEqual(4)
    expect(LP.counts.labels - labels).toBeLessThanOrEqual(2)
    expect(lines).toBeGreaterThanOrEqual(80)
    expect(labels).toBeGreaterThanOrEqual(40)
    // and never MORE than the vendor, which would be a different defect
    expect(lines).toBeLessThanOrEqual(LP.counts.lines)
    expect(labels).toBeLessThanOrEqual(LP.counts.labels)
  })
})

describe('⛔⛔ Trendlines — KNOWN DIVERGENCE, root cause located', () => {
  // ⚰️⚰️ RC-A FIXED THIS IN ONE LANE OF TWO, AND THE VENDOR IS WHAT SAID SO.
  // `//@version=4` scripts spell `ta.pivothigh` bare, and RC-A resolves the bare
  // name to Pine's shifted column — verified: `translatePine` on this very
  // construct returns `pivothigh(high, 100, 15)[15]`.
  //
  // ⛔ BUT THE OBJECT LANE NEVER SEES THAT RESOLUTION. `buildObjectLane` calls
  // `translatePine` with `objectRawTrees: true`, which deliberately keeps the
  // RAW PARSE NODE so the runtime lane can lower constructs the columnar value
  // model has no answer for (`array.get`). RC-A's transform lives in the
  // columnar resolution those trees bypass, so the runtime lane still resolves
  // bare `pivothigh` to the house column — which emits ON the pivot bar, not at
  // the confirmation bar `right` bars later.
  //
  // ⛔⛔ AND THAT IS LOOK-AHEAD, NOT AN OFFSET — the same class RC-A exists to
  // remove, surviving in the lane that draws objects.
  //
  // ⭐ THE SIGNATURE IS EXACT AND SO IS THE ASSERTION: our RIGHT anchor is the
  // vendor's LEFT anchor, on every line. A vaguer "the dates differ" would pass
  // for any wrong answer; this one passes only for THIS wrong answer, so the
  // day the runtime lane gets the transform, it fails and says so.
  it('⛔ our RIGHT anchor is exactly the vendor\'s LEFT anchor, on every line', () => {
    const { st } = runScript('corpus/committed/trendlines__43QQg9nDN0.pine', DEEP)
    const ourRights = new Set((st.lines || []).map((l) => dateOf(l.x2)))
    expect(ourRights.size, 'we drew no trendlines at all').toBeGreaterThan(0)

    const vendorLefts = V.scripts.trendlines.lines.map((l) => l[0])
    expect(vendorLefts.length).toBe(5)

    const matched = vendorLefts.filter((d) => ourRights.has(d))
    expect(matched, 'the anchor offset changed shape — re-measure rather than '
      + 'adjusting this rail').toEqual(vendorLefts)

    // ⛔ AND WE DO NOT ALREADY AGREE: if any of our right anchors equalled a
    // vendor RIGHT anchor, the divergence would be partly closed and this case
    // would be describing a chart that no longer exists.
    const vendorRights = new Set(V.scripts.trendlines.lines.map((l) => l[1]))
    expect([...ourRights].filter((d) => vendorRights.has(d)),
      'some anchors now agree with the vendor — this divergence is closing, '
      + 'update it instead of leaving a stale description').toEqual([])
  })
})
