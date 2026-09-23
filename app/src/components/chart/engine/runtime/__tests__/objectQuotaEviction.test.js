// app/src/components/chart/engine/runtime/__tests__/objectQuotaEviction.test.js
//
// ─── ⛔⛔ PINE EVICTS THE OLDEST. WE KEPT IT. ───────────────────────────────
//
// Pine's drawing-object budget has three parts. Measured against TradingView on
// 2026-09-23, this engine had two of them wrong:
//
//   | | Pine | this engine (before) |
//   |---|---|---|
//   | declared `max_*_count` | honoured, ≤ 500 | ✅ already read |
//   | default when undeclared | **50** | ❌ 500 |
//   | at the cap | **evict the OLDEST** | ❌ `fail()` — keep the oldest |
//
// ⚰️⚰️ WHAT THE `fail()` COST, AND IT IS NOT SUBTLE. `liquidity-pools` hit the
// cap and stopped creating, so the objects it still held were the OLDEST ones:
// its newest surviving line was **2025-04-09** against a series running to
// **2026-09-11**. TradingView held the newest 90. Zero overlap — we were
// drawing a year-stale chart and every count looked healthy.
//
// ⭐ AND THE CORRECT RULE WAS ALREADY IN THE REPO, UNWIRED. `objectPool.js`
// carries Pine's capacity table (fallback 50, ceiling 500) and its FIFO. It was
// parked on the reachability allowlist with an expiry of "Wave 2 close,
// 2026-09-14" — a date that had passed. This wires its CAPACITY POLICY.
//
// ⛔ BUT NOT ITS STORAGE, AND THE SPLIT IS DELIBERATE. `objectRuntime` already
// owns a `live` Map that is insertion-ordered (so already FIFO), and that map is
// what registers, collections, table cells and the output ordering all read.
// Giving the pool a second copy would create two truths about what is live and
// they would drift on the first `delete`. So: capacity has ONE owner
// (`objectPool.resolveCapacity`), liveness has ONE owner (`runtime.live`).
//
// ⛔⛔ AND AN EVICTED OBJECT MUST LEAVE EVERY CONTAINER THAT NAMED IT — exactly
// as a deleted one does. The runtime's `delete` already said so: *"otherwise a
// register or collection keeps a handle to nothing and the next write silently
// lands nowhere."* Eviction is a second way for an object to stop existing, so
// it goes through the SAME teardown; a second copy of that cleanup is the bug
// that comment is about, one level up.
import { describe, it, expect } from 'vitest'

import { buildObjectLane, runObjectLane } from '../objectLane.js'
import { POOL_LIMITS, resolveCapacity } from '../../objectPool.js'
import { OBJECT_STATUS } from '../../objectRuntime.js'
import { MAX_COLLECTION_CAP } from '../../ast/objectProgram.js'

const makeBars = (n) => Array.from({ length: n }, (_, i) => ({
  t: 1700000000 + i * 86400,
  o: 100 + (i % 7), h: 104 + (i % 5), l: 96 - (i % 3), c: 100 + (i % 11), v: 1000000 + i,
}))
const seriesOf = (bars) => ['o', 'h', 'l', 'c', 'v']
  .map((k) => Float64Array.from(bars.map((b) => b[k])))

const N = 220
const BARS = makeBars(N)
const SERIES = seriesOf(BARS)
const LF = String.fromCharCode(10)
const Q = String.fromCharCode(34)

/** One line per bar — far more than any default cap, so the policy is what decides. */
function oneLinePerBar(decl) {
  return `//@version=5${LF}indicator(${Q}t${Q}, overlay = true${decl ? `, ${decl}` : ''})${LF}`
    + `line.new(bar_index, low, bar_index, high)${LF}`
}

function runOver(src, bars, series) {
  const lane = buildObjectLane(src, { tf: 'D', newestBarIsForming: false, bars })
  expect(lane.ok, lane.ok ? '' : `refused ${(lane.refusal || {}).guard}`).toBe(true)
  return runObjectLane(lane, {
    bars: bars.length, series, confirmed: true, readTime: (i) => bars[i].t,
  })
}

const run = (src) => runOver(src, BARS, SERIES)

/** The bar each surviving object was created on, oldest first. */
const createdBars = (r) => (r.live || []).map((o) => o.createdBar)

describe('⛔⛔ the drawing quota evicts the OLDEST, as Pine does', () => {
  it('⛔ CONTROL — the fixture really does overflow any default cap', () => {
    // ⭐ A script that never reaches the cap would make every assertion below
    // pass without the policy running at all.
    expect(N).toBeGreaterThan(POOL_LIMITS.line.fallback * 2)
    expect(POOL_LIMITS.line.fallback).toBe(50)
    expect(POOL_LIMITS.line.ceiling).toBe(500)
  })

  it('⭐⭐ an UNDECLARED script keeps 50 — Pine\'s default, not 500', () => {
    const r = run(oneLinePerBar(null))
    expect(r.live.length).toBe(resolveCapacity('line', null).capacity)
    expect(r.live.length).toBe(50)
  })

  it('⭐⭐ and the 50 it keeps are the NEWEST — this is the whole defect', () => {
    // ⚰️ Before the fix the survivors were bars 0..49. `liquidity-pools` showed
    // what that means on a real chart: a year-stale set, drawn confidently.
    const bars = createdBars(run(oneLinePerBar(null)))
    expect(bars.length).toBe(50)
    expect(Math.min(...bars), 'the OLDEST objects survived — eviction is inverted')
      .toBe(N - 50)
    expect(Math.max(...bars)).toBe(N - 1)
  })

  it('⭐ a DECLARED max_lines_count is honoured, and clamped at Pine\'s ceiling', () => {
    // a declared cap BELOW the number of bars is observable directly
    expect(run(oneLinePerBar('max_lines_count = 120')).live.length).toBe(120)

    // ⛔ THE CEILING IS ASSERTED ON THE POLICY, NOT ON THE LIVE COUNT, AND THE
    // REASON IS THAT THE FIXTURE CANNOT SHOW IT. This script makes at most one
    // line per bar, so with 220 bars a cap of 500 and a cap of 5000 produce the
    // SAME 220 survivors — the live count cannot distinguish them, and a test
    // that asserted 500 there would be asserting a number the run can never
    // reach (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`).
    expect(resolveCapacity('line', 5000).capacity).toBe(POOL_LIMITS.line.ceiling)
    expect(resolveCapacity('line', 5000).clamped).toBe(true)
    expect(run(oneLinePerBar('max_lines_count = 5000')).live.length).toBe(N)
  })

  it('⛔⛔ CODE, NEVER PROSE — a commented-out declaration does not raise the cap', () => {
    // ⚰️ The scan that reads `max_*_count` runs over the RAW source, so a
    // mention inside a comment or a string used to set the budget. This repo has
    // paid for that exact shape six times in one session
    // (`CLAUDE.md`: "every literal-hunting check strips comments first").
    const src = `//@version=5${LF}`
      + `// max_lines_count = 500 would be nice here${LF}`
      + `indicator(${Q}t${Q}, overlay = true)${LF}`
      + `line.new(bar_index, low, bar_index, high)${LF}`
    expect(run(src).live.length, 'a COMMENT set the drawing budget').toBe(50)
  })

  it('⛔⛔ an EVICTED object leaves every CONTAINER that named it', () => {
    // ⭐ THE INVARIANT THE DELETE PATH ALREADY STATED, now owed by eviction too:
    // "otherwise a register or collection keeps a handle to nothing and the next
    // write silently lands nowhere."
    //
    // ⚰️ THIS TEST USED TO ASSERT `new Set(ids).size === live.length` AND PROVED
    // NOTHING. That is trivially true of any run — it never read a register or a
    // collection at all — so gutting `reap` down to `live.delete(id)` left all
    // seven cases green. The title promised what the body never checked, which
    // is `lesson_a_fixture_that_cannot_distinguish_is_not_a_rail` exactly.
    //
    // ⛔⛔ AND ONLY THE COLLECTION HALF IS OBSERVABLE, SO ONLY IT IS ASSERTED.
    // Object ids are a monotonic counter and are NEVER reused, so a register
    // still holding an evicted id resolves to an id that is absent from `live`
    // — and `case 'update'` counts that as a write-to-deleted, byte for byte
    // what a CLEARED register produces (`target === null` takes the same branch
    // one line up). Asserting the register half would be asserting a difference
    // the runtime cannot express. The cleanup stays in `reap` because the
    // invariant is real; it is recorded here as UNOBSERVABLE rather than
    // dressed in an assertion that would pass either way.
    //
    // ⭐ THE COLLECTION HALF IS LOAD-BEARING AND THIS IS WHY: a collection
    // carries a cap, so an array whose evicted members are never spliced out
    // grows by one every bar and REFUSES THE RUN when it reaches that cap — on
    // a script whose live set never exceeds 50.
    const src = `//@version=5${LF}indicator(${Q}t${Q}, overlay = true)${LF}`
      + `var lines = array.new_line(0)${LF}`
      + `array.push(lines, line.new(bar_index, low, bar_index, high))${LF}`

    // ⛔ CONTROL — the fixture must be long enough to REACH the cap, or the
    // assertion below passes for a run that was simply too short to overflow.
    const LONG = MAX_COLLECTION_CAP + 60
    expect(LONG).toBeGreaterThan(MAX_COLLECTION_CAP)
    const bars = makeBars(LONG)

    const r = runOver(src, bars, seriesOf(bars))
    expect(r.status, `the run refused: ${r.reason}`).toBe(OBJECT_STATUS.OK)
    expect(r.live.length, 'the quota stopped holding while the array grew').toBe(50)
  })

  it('⭐ the count is per FAMILY, not shared', () => {
    // ⛔ A shared budget would let boxes starve lines. Pine sizes each pool
    // independently, which is why `POOL_LIMITS` is keyed by kind.
    const src = `//@version=5${LF}indicator(${Q}t${Q}, overlay = true)${LF}`
      + `line.new(bar_index, low, bar_index, high)${LF}`
      + `box.new(bar_index, high, bar_index + 1, low)${LF}`
    const r = run(src)
    const byFam = {}
    for (const o of r.live) byFam[o.family] = (byFam[o.family] || 0) + 1
    expect(byFam.line).toBe(50)
    expect(byFam.box).toBe(50)
  })
})
