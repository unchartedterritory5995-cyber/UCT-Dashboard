// ⭐ THE DERIVED VALUES KEPT ARE BOUNDED IN BARS, AND NEVER LOSE THE ROW ON SCREEN OR THE NEXT ONE (2026-11-25,
// review of #2729; neighborFrames DERIVED_BARS_*, holdRow).
//
// Counting rows let one row's depth multiply what is kept (ten 20,000-bar minute rows), and neighbor frames are not
// device-gated while iOS Safari kills a tab early. The derived values kept now count their bars (every derived array
// its length, a Set its size) against a budget, the least recently used rows going first; the row each chart shows and
// the row it prepared first are held.
//   1. over the budget, rows go by bars, oldest first, and fewer than the row bound stay (the bars bound it);
//   2. the rows held (shown, next) of two charts stay through any number of newer rows, the budget and the row bound;
//      released, they go like any other;
//   3. the desktop budget does NOT bind on the replayed 1m + 15m S&P 500 board: its heaviest press's ten rows (the
//      session rows the 2026-11-25 replay recorded) are all kept, and the bars held are exactly 5 x their session rows
//      plus the HVC sets;
//   4. the touch tier (≤1024 px or a coarse pointer) gets the lower budget, read from the page's media queries;
//   5. a value dropped for the budget is computed again to the same numbers (the equality proofs are unchanged).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  deriveFrom, hasDerived, chartTimesFor, SOURCES_KEPT, __resetDerivedForTests, stableSig,
  holdRow, releaseRows, derivedHeld, derivedBarsBudget, derivedBarsBudgetFor, __setDerivedBarsBudgetForTests,
  DERIVED_BARS_DESKTOP, DERIVED_BARS_TOUCH,
} from './neighborFrames'
import { deriveSession, deriveDisplay, deriveHvc, deriveVolExtremes, deriveVol, deriveVolMa, deriveOhlcBase, deriveClose, volRecipeOf, volExtremesRecipeOf } from './useNeighborFrames'
import { sessionBarsOf, ohlcBaseOf, closeDataOf, volDataOf, volMaDataOf, computeHVC, volExtremesOf } from './chartDerived'
import { chartTimeOf } from '../../data/barStore/adapter'
import { etUnix } from '../../data/barStore/__fixtures__/seededSeries'
import { isHolidayISO } from '../../utils/marketSession'

beforeEach(() => { __resetDerivedForTests(); __setDerivedBarsBudgetForTests(null) })
afterEach(() => { __setDerivedBarsBudgetForTests(null); vi.unstubAllGlobals() })

/** Minute rows of row `k` holding exactly `rth` regular-session rows, with 30 pre-market rows a day around them. */
function minuteRows(k, rth) {
  const dates = []
  const days = Math.ceil(rth / 390)
  for (let ms = Date.UTC(2026, 10, 13); dates.length < days; ms -= 86_400_000) {
    const wd = new Date(ms).getUTCDay()
    const iso = new Date(ms).toISOString().slice(0, 10)
    if (wd !== 0 && wd !== 6 && !isHolidayISO(iso)) dates.push(iso)
  }
  dates.reverse()
  const out = []
  let i = 0
  let left = rth - (days - 1) * 390                 // the first day is the partial one
  for (const d of dates) {
    for (let m = 480; m < 510; m++) out.push(bar(etUnix(d, m), i++, k))          // 08:00-08:29, extended
    const n = left
    for (let m = 570 + (390 - n); m < 960; m++) out.push(bar(etUnix(d, m), i++, k))
    left = 390
  }
  return out
}
function bar(t, i, k) {
  const c = 40 * k + Math.sin(i / 23) * 3 * k + i * 0.0005
  return { t, o: c - 0.2, h: c + 0.5, l: c - 0.6, c, v: 1000 + ((i * 7919 * k) % 70000) }
}
function recipesOf() {
  const p = { intradayLike: true, isIntraday: true, showExtended: false, tf: '1' }
  const closeP = { plain: true, mode: 'netchange', up: '#26a69a', down: '#ef5350' }
  const volP = { colorMode: 'updown', up: '#26a69a', down: '#ef5350', hvcColor: '#ffd700' }
  return {
    adjustTime: chartTimeOf, session: { p, sig: stableSig(p) }, heikinAshi: false, hvcOn: true,
    ohlc: { sunrise: false, sig: 'plain|at1' }, close: { p: closeP, sig: `${stableSig(closeP)}|at1` },
    vol: volRecipeOf(volP, 1, true), vx: volExtremesRecipeOf(true, null, null), volMa: { on: true, period: 20, sig: 'ma20|at1' },
  }
}
/** The chain a chart (or the preparer) runs over one row's rows. */
function chain(all, r) {
  const filtered = deriveSession(all, r)
  const display = deriveDisplay(filtered, r)
  chartTimesFor(display, r.adjustTime)
  const hvc = deriveHvc(filtered, r)
  const vx = deriveVolExtremes(filtered, r)
  return {
    filtered, hvc, vx, ohlc: deriveOhlcBase(display, r), close: deriveClose(display, r),
    vol: deriveVol(filtered, hvc, vx, r), volMa: deriveVolMa(filtered, r),
  }
}
function filed(all, r) {
  if (!hasDerived(all, 'session', r.session.sig)) return false
  const f = deriveFrom(all, 'session', r.session.sig, () => { throw new Error('not filed') })
  return hasDerived(f, 'hvc', '') && hasDerived(f, 'ohlcBase', r.ohlc.sig) && hasDerived(f, 'close', r.close.sig)
    && hasDerived(f, 'volMa', r.volMa.sig)
}
const fresh = (all, r) => {
  const f = sessionBarsOf(all, r.session.p)
  const hvc = computeHVC(f)
  const vx = volExtremesOf(f, null, null)
  return JSON.stringify({ f, hvc: [...hvc].sort(), vx, o: ohlcBaseOf(f, false, chartTimeOf), c: closeDataOf(f, r.close.p, chartTimeOf),
    v: volDataOf(f, r.vol.p, hvc, vx, chartTimeOf), m: volMaDataOf(f, 20, chartTimeOf) })
}
const asJson = (c) => JSON.stringify({ f: c.filtered, hvc: [...c.hvc].sort(), vx: c.vx, o: c.ohlc, c: c.close, v: c.vol, m: c.volMa })

describe('the derived values kept are bounded in bars', () => {
  it('1. over the budget, rows go by bars, oldest first, and fewer than the row bound stay', () => {
    const r = recipesOf()
    const rows = Array.from({ length: 8 }, (_, i) => minuteRows(i + 1, 1000))
    chain(rows[0], r)
    const one = derivedHeld().derived.bars
    expect(one).toBeGreaterThanOrEqual(4900)            // 5 arrays over the 1,000 session rows, plus the HVC set
    __setDerivedBarsBudgetForTests(Math.floor(one * 3.5))
    for (const all of rows.slice(1)) {
      chain(all, r)
      const h = derivedHeld().derived
      expect(h.bars).toBeLessThanOrEqual(derivedBarsBudget())
    }
    expect(derivedHeld().derived.rows).toBe(3)
    expect(derivedHeld().derived.rows).toBeLessThan(SOURCES_KEPT)
    expect(rows.map((a) => filed(a, r))).toEqual([false, false, false, false, false, true, true, true])
  })

  it('2. the rows two charts show and will land on next stay, through the budget and the row bound; released, they go', () => {
    const r = recipesOf()
    const A = [minuteRows(1, 1000), minuteRows(2, 1000)]
    const B = [minuteRows(3, 1000), minuteRows(4, 1000)]
    const ownerA = {}
    const ownerB = {}
    for (const all of [...A, ...B]) chain(all, r)
    holdRow(ownerA, 'shown', A[0]); holdRow(ownerA, 'next', A[1])
    holdRow(ownerB, 'shown', B[0]); holdRow(ownerB, 'next', B[1])
    const one = Math.ceil(derivedHeld().derived.bars / 4)
    __setDerivedBarsBudgetForTests(one * 5)
    for (let i = 0; i < SOURCES_KEPT + 5; i++) chain(minuteRows(10 + i, 1000), r)
    for (const all of [...A, ...B]) expect(filed(all, r)).toBe(true)
    // the budget still bounds the rest: the 4 held rows and at most one more
    expect(derivedHeld().derived.rows).toBeLessThanOrEqual(5)
    // held through a session-filtered child too (the hold names the row, whatever array it was given)
    holdRow(ownerA, 'shown', deriveSession(A[0], r))
    releaseRows(ownerB)
    for (let i = 0; i < 3; i++) chain(minuteRows(40 + i, 1000), r)
    expect(filed(A[0], r) && filed(A[1], r)).toBe(true)
    expect(filed(B[0], r) || filed(B[1], r)).toBe(false)
  })

  it('3. the desktop budget does not bind on the replayed 1m + 15m S&P 500 board: its heaviest ten rows all stay', () => {
    __setDerivedBarsBudgetForTests(derivedBarsBudgetFor({ touch: false }))
    expect(derivedBarsBudget()).toBe(DERIVED_BARS_DESKTOP)
    const r = recipesOf()
    // the session rows of the ten most recent rows at the replay's heaviest press (run 3, 2026-11-25)
    const SESSION_ROWS = [10255, 11037, 14265, 14451, 15517, 15661, 18757, 19472, 22271, 24465]
    const rows = SESSION_ROWS.map((n, i) => minuteRows(i + 1, n))
    // what was derived, in bars: the session rows, candles, closes, volume (each one per session row), the volume average
    // (from its 20th row on), the HVC set; the extremes are one object
    let derived = 0
    for (const all of rows) {
      const c = chain(all, r)
      derived += c.filtered.length + c.ohlc.length + c.close.length + c.vol.length + c.volMa.length + c.hvc.size
    }
    expect(rows.map((a) => filed(a, r))).toEqual(rows.map(() => true))
    expect(rows.map((a) => sessionBarsOf(a, r.session.p).length)).toEqual(SESSION_ROWS)
    const held = derivedHeld().derived
    expect(held.rows).toBe(10)
    expect(held.bars).toBe(derived)
    expect(held.bars).toBeLessThanOrEqual(5 * SESSION_ROWS.reduce((a, b) => a + b, 0) + 10_000)
    expect(held.bars).toBeLessThan(DERIVED_BARS_DESKTOP)
    expect(derivedHeld().times.bars).toBe(SESSION_ROWS.reduce((a, b) => a + b, 0))
    // eslint-disable-next-line no-console
    console.log(`[derived budget] the replay's heaviest ten rows: ${held.bars} derived bars of ${DERIVED_BARS_DESKTOP} (x${(DERIVED_BARS_DESKTOP / held.bars).toFixed(2)} room)`)
  }, 60_000)

  it('4. the touch tier (≤1024 px or a coarse pointer) gets the lower budget, from the page\'s media queries', () => {
    expect(DERIVED_BARS_TOUCH).toBeLessThan(DERIVED_BARS_DESKTOP)
    const media = (hit) => vi.stubGlobal('matchMedia', (q) => ({ matches: hit(q), media: q, addEventListener() {}, removeEventListener() {} }))
    for (const [label, hit, want] of [
      ['a desktop window, a fine pointer', () => false, DERIVED_BARS_DESKTOP],
      ['a window ≤1024 px', (q) => q === '(max-width: 1024px)', DERIVED_BARS_TOUCH],
      ['a coarse pointer (a touchscreen laptop too)', (q) => q === '(pointer: coarse)', DERIVED_BARS_TOUCH],
    ]) {
      media(hit)
      __setDerivedBarsBudgetForTests(null)
      expect(derivedBarsBudget(), label).toBe(want)
    }
  })

  it('5. a value dropped for the budget is computed again to the same numbers', () => {
    const r = recipesOf()
    const first = minuteRows(1, 1500)
    const before = chain(first, r)
    expect(asJson(before)).toBe(fresh(first, r))
    __setDerivedBarsBudgetForTests(10_000)
    for (let i = 0; i < 4; i++) chain(minuteRows(5 + i, 1500), r)
    expect(filed(first, r)).toBe(false)
    const again = chain(first, r)
    expect(again.ohlc).not.toBe(before.ohlc)
    expect(asJson(again)).toBe(asJson(before))
  })
})
