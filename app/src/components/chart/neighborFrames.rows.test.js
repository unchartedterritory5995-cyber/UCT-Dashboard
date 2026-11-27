// ⭐ ROWS, NOT ARRAYS: THE ROW THE NEXT PRESS LANDS ON KEEPS WHAT WAS PREPARED FOR IT (2026-11-25, next-row key task).
//
// What the chart derives from a row (chart/useNeighborFrames.js `derive*`, the chart's own memos and the preparer's)
// is filed under the array it came from (neighborFrames.deriveFrom, chartTimesFor), and only the SOURCES_KEPT most
// recently used are kept. That bound was meant in rows and counted arrays: an intraday row with its regular-session
// filter is two arrays (its rows; the session-filtered rows every other derivation reads). On a two-chart board the
// row on screen plus the three rows prepared around the selection were 16 arrays, and the LRU dropped the oldest, the
// row prepared FIRST: the next row (the next-row replay, 2026-11-25: 67 of 76 session derivations in the presses' key
// tasks missed although every render read the very rows array the preparer had read). An array derived from a row's
// rows is now filed under that row (`linkDerivedSource`, from deriveSession / deriveDisplay).
//   1. two charts, the row on screen and the three prepared rows each: everything prepared for the next row of both
//      charts is still filed when the member presses (before: the next row of the first chart was gone);
//   2. the bound is in rows: of 11 rows the oldest one goes, all of it (its rows' and its session rows' values, its
//      chart times), and the 10 newest stay whole;
//   3. every rows array a switch can bring (the same array, the newest row re-answered, a row appended, history
//      prepended, a split-adjusted history; the regular and the extended session of the same rows): what the chain
//      returns equals the full computation, value for value, and only the SAME array is answered from what was filed;
//   4. a derived array is filed under the first row it was derived from.
import { describe, it, expect, beforeEach } from 'vitest'
import {
  deriveFrom, hasDerived, chartTimesFor, linkDerivedSource, SOURCES_KEPT,
  __resetDerivedForTests, neighborFramesStats, __resetNeighborFramesStatsForTests, stableSig,
} from './neighborFrames'
import {
  deriveSession, deriveDisplay, deriveHvc, deriveVolExtremes, deriveVol, deriveVolMa, deriveOhlcBase, deriveClose,
  volRecipeOf, volExtremesRecipeOf,
} from './useNeighborFrames'
import { sessionBarsOf, ohlcBaseOf, closeDataOf, volDataOf, volMaDataOf, computeHVC, volExtremesOf } from './chartDerived'
import { toHeikinAshi } from './indicators'
import { chartTimeOf } from '../../data/barStore/adapter'
import { etUnix } from '../../data/barStore/__fixtures__/seededSeries'

beforeEach(() => { __resetDerivedForTests(); __resetNeighborFramesStatsForTests() })

/** `days` sessions of 15-minute rows, 04:00 to 20:00 ET (extended hours included), for row `k`. */
function rowsOf(k, days = 30) {
  const out = []
  const dates = []
  for (let ms = Date.UTC(2026, 10, 13); dates.length < days; ms -= 86_400_000) {
    const wd = new Date(ms).getUTCDay()
    if (wd !== 0 && wd !== 6) dates.push(new Date(ms).toISOString().slice(0, 10))
  }
  dates.reverse()
  let i = 0
  for (const d of dates) {
    for (let m = 240; m < 1200; m += 15) {
      const c = 40 * k + Math.sin(i / 17) * 4 * k + i * 0.002
      out.push({ t: etUnix(d, m), o: c - 0.3, h: c + 0.9, l: c - 1.1, c, v: 1000 + ((i * 7919 * k) % 90000) })
      i++
    }
  }
  return out
}

/** The chart's recipes (StockChart `_nfRecipes`), regular session unless `ext`. */
function recipesOf(ext = false) {
  const p = { intradayLike: true, isIntraday: true, showExtended: ext, tf: '15' }
  const closeP = { plain: true, mode: 'netchange', up: '#26a69a', down: '#ef5350' }
  const volP = { colorMode: 'updown', up: '#26a69a', down: '#ef5350', hvcColor: '#ffd700' }
  return {
    adjustTime: chartTimeOf,
    session: { p, sig: stableSig(p) },
    heikinAshi: false,
    hvcOn: true,
    ohlc: { sunrise: false, sig: 'plain|at1' },
    close: { p: closeP, sig: `${stableSig(closeP)}|at1` },
    vol: volRecipeOf(volP, 1, true),
    vx: volExtremesRecipeOf(true, null, null),
    volMa: { on: true, period: 20, sig: 'ma20|at1' },
  }
}

/** The whole chain a chart (or the preparer) runs over one row's rows: what it returns. */
function chain(all, r) {
  const filtered = deriveSession(all, r)
  const display = deriveDisplay(filtered, r)
  const times = chartTimesFor(display, r.adjustTime)
  const hvc = deriveHvc(filtered, r)
  const vx = deriveVolExtremes(filtered, r)
  return {
    filtered, display, times, hvc, vx,
    ohlc: deriveOhlcBase(display, r), close: deriveClose(display, r),
    vol: deriveVol(filtered, hvc, vx, r), volMa: deriveVolMa(filtered, r),
  }
}
/** Is every value of the chain for `all` still filed (nothing would be computed again)? */
function filed(all, r) {
  if (!hasDerived(all, 'session', r.session.sig)) return false
  const filtered = deriveFrom(all, 'session', r.session.sig, () => { throw new Error('not filed') })
  return hasDerived(filtered, 'hvc', '') && hasDerived(filtered, 'volExtremes', r.vx.sig)
    && hasDerived(filtered, 'ohlcBase', r.ohlc.sig) && hasDerived(filtered, 'close', r.close.sig)
    && hasDerived(filtered, 'volMa', r.volMa.sig)
}
/** The full computation, nothing filed (the chart's functions called directly). */
function fresh(all, r) {
  const filtered = sessionBarsOf(all, r.session.p)
  const hvc = computeHVC(filtered)
  const vx = volExtremesOf(filtered, null, null)
  return JSON.stringify({
    filtered, hvc: [...hvc].sort(), vx,
    ohlc: ohlcBaseOf(filtered, false, chartTimeOf), close: closeDataOf(filtered, r.close.p, chartTimeOf),
    vol: volDataOf(filtered, r.vol.p, hvc, vx, chartTimeOf), volMa: volMaDataOf(filtered, 20, chartTimeOf),
  })
}
const asJson = (c) => JSON.stringify({ filtered: c.filtered, hvc: [...c.hvc].sort(), vx: c.vx, ohlc: c.ohlc, close: c.close, vol: c.vol, volMa: c.volMa })

describe('rows, not arrays: what was prepared for the next row is kept until the press', () => {
  it('the fixture: a row is two arrays (its rows; its regular-session rows)', () => {
    const all = rowsOf(1)
    const c = chain(all, recipesOf())
    expect(c.filtered).not.toBe(all)
    expect(c.filtered.length).toBeLessThan(all.length)
  })

  it('1. two charts: the row on screen and three prepared rows each; at the press the next row of BOTH is all filed', () => {
    const r = recipesOf()
    const A = [1, 2, 3, 4].map((k) => rowsOf(k))          // chart 1: on screen, then +1, -1, +2
    const B = [1, 2, 3, 4].map((k) => rowsOf(k, 20))      // chart 2 (another timeframe of the same names)
    chain(A[0], r); chain(B[0], r)                        // the rows on screen
    for (const rank of [1, 2, 3]) { chain(A[rank], r); chain(B[rank], r) }   // the preparer: nearest rank first, both charts
    expect(filed(A[1], r), 'chart 1, the next row').toBe(true)
    expect(filed(B[1], r), 'chart 2, the next row').toBe(true)
    // ...and the press takes it: the chain answers every value from what was filed (no derivation runs)
    const before = neighborFramesStats().derivedHit
    const timesBuilt = neighborFramesStats().timesBuilt
    chain(A[1], r)
    expect(neighborFramesStats().derivedHit - before).toBe(7)   // session, HVC, extremes, candles, closes, volume, its average
    expect(neighborFramesStats().timesBuilt - timesBuilt).toBe(0)
  })

  it(`2. the bound is in rows: of ${SOURCES_KEPT + 1} rows the oldest goes, all of it, and the newest ${SOURCES_KEPT} stay whole`, () => {
    const r = recipesOf()
    const rows = Array.from({ length: SOURCES_KEPT + 1 }, (_, i) => rowsOf(i + 1, 4))
    const chains = rows.map((all) => chain(all, r))
    expect(filed(rows[0], r)).toBe(false)
    expect(hasDerived(chains[0].filtered, 'hvc', ''), 'the oldest row\'s session rows went with it').toBe(false)
    for (let i = 1; i < rows.length; i++) expect(filed(rows[i], r), `row ${i}`).toBe(true)
  })

  it('3. every rows array a switch can bring: the full computation, value for value; only the same array is answered from the file', () => {
    const r = recipesOf()
    const rExt = recipesOf(true)
    const base = rowsOf(1)
    const first = chain(base, r)
    const lastRth = base.findIndex((b) => b.t === etUnix('2026-11-13', 945))   // the newest regular-session row
    expect(lastRth).toBeGreaterThan(0)
    const kinds = {
      'the same array': base,
      'the newest row re-answered': base.map((b, i) => (i === lastRth ? { ...b, c: b.c + 0.37, h: b.h + 0.4, v: b.v + 777 } : b)),
      'a row appended': [...base, { t: etUnix('2026-11-16', 570), o: 41, h: 42, l: 40.5, c: 41.3, v: 5000 }],
      'history prepended': [...rowsOf(1, 33).filter((b) => b.t < base[0].t), ...base],
      'a split-adjusted history': base.map((b) => ({ ...b, o: b.o / 2, h: b.h / 2, l: b.l / 2, c: b.c / 2, v: b.v * 2 })),
    }
    for (const [label, all] of Object.entries(kinds)) {
      const got = chain(all, r)
      expect(asJson(got), label).toBe(fresh(all, r))
      if (all === base) {
        expect(got.filtered, label).toBe(first.filtered)
        expect(got.ohlc, label).toBe(first.ohlc)
        expect(got.vol, label).toBe(first.vol)
      } else {
        expect(got.filtered, label).not.toBe(first.filtered)
        expect(got.ohlc, label).not.toBe(first.ohlc)
        expect(got.volMa, label).not.toBe(first.volMa)
      }
    }
    // the extended session of the same rows: another question, its own answers, each the full computation
    const ext = chain(base, rExt)
    expect(ext.filtered).not.toBe(first.filtered)
    expect(asJson(ext)).toBe(fresh(base, rExt))
    expect(asJson(chain(base, r))).toBe(fresh(base, r))
    // Heikin-Ashi display rows: filed under the same row, and equal to the full computation
    const rHa = { ...r, heikinAshi: true }
    const ha = deriveDisplay(first.filtered, rHa)
    expect(JSON.stringify(ha)).toBe(JSON.stringify(toHeikinAshi(sessionBarsOf(base, r.session.p))))
    expect(deriveDisplay(first.filtered, rHa)).toBe(ha)
  })

  it('4. a derived array is filed under the first row it was derived from (a second link is ignored)', () => {
    const r = recipesOf()
    const a = rowsOf(1, 3)
    const b = rowsOf(2, 3)
    const child = deriveSession(a, r)
    deriveHvc(child, r)
    chain(b, r)
    linkDerivedSource(child, b)          // ignored: child stays a's
    // b stays recent, a does not: a's row goes, and child's values with it
    for (let i = 0; i < SOURCES_KEPT; i++) { chain(rowsOf(i + 30, 2), r); deriveSession(b, r) }
    expect(filed(b, r)).toBe(true)
    expect(hasDerived(a, 'session', r.session.sig)).toBe(false)
    expect(hasDerived(child, 'hvc', '')).toBe(false)
  })
})
