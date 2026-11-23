/**
 * NEXT-ROW CHART WALKS, ITEM (ii), VOLUME: THE BOARD'S VOLUME BARS ARE PREPARED FOR THE NEXT ROW (2026-11-23).
 *
 * The production profile of a next-row press showed the volume series' data built at the press (chartDerived.volDataOf:
 * one object per bar over the whole array, ~1.7 ms) although neighbor frames prepare the next row's arrays in idle.
 * Why: the /charts pane look marks the highest-volume-ever bar (pane/paneLook.js `markVolumeExtremes: true`), and the
 * volume recipe was `on: !markVolumeExtremes`. The preparer could not know the chart's `volExtremes` object (a fresh
 * `{goldTimes}` per chart memo), and the prepared volume is filed under that object's identity, so for the board the
 * volume was never prepared, and the extremes scan ran at the press too.
 *   V1 the board's recipe (markVolumeExtremes on): after the row is prepared, the chart's arrival finds BOTH its volume
 *      extremes and its volume bars already filed (no compute at the press)
 *   V2 what the chart gets is what it computed before: volDataOf over the bars with computeHVC and the extremes, no frames
 *   V3 the extremes are the chart memo's as before (in the year, outside it, open bounds, no volume, marking off)
 *   V4 a chart that does not mark the extremes prepares its volume as before (extremes null)
 *   V5 (review of #2632) a row whose snapshot holds a FORMING bar: the prepared volume, forming bar included, is what the
 *      chart computes, and the extremes are found on the bars with it
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
const snaps = new Map()
const fakeStore = {
  registry: { has: (k) => snaps.has(k) },
  getBaseSnapshot: (k) => snaps.get(k) ?? null,
}
vi.mock('../../data/barStore/index', () => ({ getBarStore: () => fakeStore }))
vi.mock('./barStoreSwitch', () => ({ BARSTORE: true }))
const {
  prepareRow, deriveSession, deriveVol, deriveHvc, volRecipeOf, volExtremesRecipeOf, deriveVolExtremes,
} = await import('./useNeighborFrames')
const { chartKeyFor } = await import('./useBarSnapshotBars')
const { legacyBars } = await import('../../data/barStore/adapter')
const nf = await import('./neighborFrames')
const { volDataOf, computeHVC } = await import('./chartDerived')
const { toChartTime } = await import('./barTime')

const adjustTime = (t) => (typeof t === 'number' ? toChartTime(t) : t)
const AT = nf.identitySig(adjustTime)
const VOL_P = { blank: false, upC: '#1a1', downC: '#a11', netChange: true, dwm: true, liveVol: NaN, bold: false }
function recipes({ mark, entryDate = null, exitDate = null }) {
  const sessionP = { intradayLike: false, isIntraday: false, showExtended: false, tf: 'D' }
  const closeP = { plain: true, mode: 'netchange', up: '#0f0', down: '#f00' }
  return {
    adjustTime,
    session: { p: sessionP, sig: nf.stableSig(sessionP) },
    heikinAshi: false, hvcOn: true,
    ohlc: { sunrise: false, sig: `plain|at${AT}` },
    close: { p: closeP, sig: `${nf.stableSig(closeP)}|at${AT}` },
    vol: volRecipeOf(VOL_P, AT, mark),
    vx: volExtremesRecipeOf(mark, entryDate, exitDate),
    volMa: { on: false, period: 20, sig: `p${nf.stableSig(20)}|at${AT}` },
    plain: true,
  }
}
const daily = (n) => Array.from({ length: n }, (_, i) => {
  const t = Math.floor(Date.UTC(2015, 0, 1) / 1000) + i * 86400
  const c = 50 + Math.sin(i / 9) * 5
  return { t, o: c - 0.4, h: c + 1, l: c - 1, c, v: 1e5 + ((i * 7919) % 104729) }
})
const view = { tf: 'D', showExtended: false }
const keyOf = (sym) => chartKeyFor({ sym, resolvedTf: 'D', showExtended: false, replayCutoff: null, hasOverride: false })
const drain = (g) => { for (const _ of g) { /* each piece */ } }
/** The volume extremes exactly as the chart's memo computed them before this change (StockChart at 44a7defafb). */
function refVolExtremes(markVolumeExtremes, filteredBars, entryDate, exitDate) {
  if (!markVolumeExtremes || !filteredBars?.length) return null
  const inYear = b => (!entryDate || b.t >= entryDate) && (!exitDate || b.t <= exitDate)
  let hve = null
  for (const b of filteredBars) if (b.v != null && (!hve || b.v > hve.v)) hve = b
  if (!hve || !inYear(hve)) return null
  return { goldTimes: new Set([hve.t]) }
}

let engineRef
beforeEach(() => {
  nf.__setNeighborFramesForTests(true)
  nf.__resetNeighborFramesStatsForTests()
  nf.__resetDerivedForTests()
  snaps.clear()
  engineRef = { current: null }
})
afterEach(() => nf.__setNeighborFramesForTests(null))

function preparedRow(sym, R, n = 600, developing = null) {
  const s = Object.freeze({ key: keyOf(sym), tf: 'D', bars: daily(n), developing, baseRev: 3, status: 'current', restSeen: true })
  snaps.set(keyOf(sym), s)
  drain(prepareRow(sym, 0, { recipes: () => R, view: () => view, engineRef }))
  return deriveSession(legacyBars(s), R)       // the chart's filteredBars on arrival (a filed hit)
}

describe("the board's volume (markVolumeExtremes on) is prepared for the next row", () => {
  it('V1 the arrival finds its volume extremes and its volume bars filed: no compute at the press', () => {
    const R = recipes({ mark: true })
    const filtered = preparedRow('NEXT', R)
    const before = nf.neighborFramesStats().derivedHit
    const h = deriveHvc(filtered, R)
    const vx = deriveVolExtremes(filtered, R)
    expect(vx).not.toBeNull()                            // the fixture has an extreme in view (or this proves nothing)
    const sig = `${R.vol.sig}|hvc${nf.identitySig(h)}|vx${nf.identitySig(vx)}`
    expect(nf.hasDerived(filtered, 'vol', sig)).toBe(true)   // filed by the preparer, under the arrival's own extremes
    deriveVol(filtered, h, vx, R)
    expect(nf.neighborFramesStats().derivedHit - before).toBe(3)   // hvc, extremes, volume: all three hits
  })

  it('V2 the bars the chart gets are the bars it computed before (no frames, nothing filed)', () => {
    const R = recipes({ mark: true })
    const filtered = preparedRow('NEXT', R)
    const got = deriveVol(filtered, deriveHvc(filtered, R), deriveVolExtremes(filtered, R), R)
    const fresh = volDataOf(filtered, VOL_P, computeHVC(filtered), refVolExtremes(true, filtered, null, null), adjustTime)
    expect(got).toEqual(fresh)
    expect(fresh.some((p) => p.color === '#e6b800')).toBe(true)   // the gold extreme is in it (or this proves little)
  })

  it('V3 the extremes are the memo\'s: in the year, outside it, open bounds, no volume, marking off', () => {
    const bars = daily(800)
    const hveT = bars.reduce((m, b) => (b.v > m.v ? b : m)).t
    const cases = [
      [true, null, null], [true, hveT, null], [true, null, hveT], [true, hveT + 1, null], [true, null, hveT - 1],
      [false, null, null],
    ]
    for (const [mark, a, b] of cases) {
      nf.__resetDerivedForTests()
      const got = deriveVolExtremes(bars, recipes({ mark, entryDate: a, exitDate: b }))
      expect(got, `mark=${mark} ${a} ${b}`).toEqual(refVolExtremes(mark, bars, a, b))
    }
    const noVol = bars.map((x) => ({ ...x, v: null }))
    expect(deriveVolExtremes(noVol, recipes({ mark: true }))).toEqual(refVolExtremes(true, noVol, null, null))
    expect(deriveVolExtremes([], recipes({ mark: true }))).toEqual(refVolExtremes(true, [], null, null))
  })

  it('V4 a chart that does not mark the extremes prepares its volume as before', () => {
    const R = recipes({ mark: false })
    const filtered = preparedRow('NEXT', R)
    const h = deriveHvc(filtered, R)
    const vx = deriveVolExtremes(filtered, R)
    expect(vx).toBeNull()
    expect(nf.hasDerived(filtered, 'vol', `${R.vol.sig}|hvc${nf.identitySig(h)}|vx${nf.identitySig(null)}`)).toBe(true)
    expect(deriveVol(filtered, h, vx, R)).toEqual(volDataOf(filtered, VOL_P, computeHVC(filtered), null, adjustTime))
  })
})

describe('the forming bar (review of #2632)', () => {
  it('V5 a snapshot with a forming bar: the prepared volume is the computed one, forming bar included', () => {
    const R = recipes({ mark: true })
    const last = daily(600)[599]
    const dev = { t: last.t + 86400, o: 52, h: 60, l: 51, c: 59, v: 9e9 }   // today's forming bar, the biggest volume yet
    const filtered = preparedRow('FORM', R, 600, dev)
    expect(filtered.length).toBe(601)                                // the forming bar is in the chart's bars (or this proves nothing)
    const h = deriveHvc(filtered, R)
    const vx = deriveVolExtremes(filtered, R)
    expect(nf.hasDerived(filtered, 'vol', `${R.vol.sig}|hvc${nf.identitySig(h)}|vx${nf.identitySig(vx)}`)).toBe(true)
    const got = deriveVol(filtered, h, vx, R)
    expect(got).toEqual(volDataOf(filtered, VOL_P, computeHVC(filtered), refVolExtremes(true, filtered, null, null), adjustTime))
    expect(got[got.length - 1]).toMatchObject({ value: 9e9, color: '#e6b800' })   // the forming bar, gold as the new extreme
  })
})
