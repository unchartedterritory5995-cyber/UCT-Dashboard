// ⭐ NEIGHBOR FRAMES FOR A CUSTOM TIMEFRAME (2026-11-27, key-task budget). A 4h / 2h / 45m chart is resampled on the
// client from its native base key; the row it is about to reach is now prepared like a native one: the base rows read
// as the chart reads them, resampled through the ONE filed derivation (customTfRows.deriveCustomTf), then the chart's
// own chain. The arriving chart finds the resample and every derived array; the binder is handed the very bars the
// chart will hand it. Measured before: one 4h chart's key task held the resample, the derived arrays and the binder's
// compute (~10 ms of a 31 ms task, ab-rerun-20261126 4h-B3), none of which a native chart pays.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const snaps = new Map()
const fakeStore = {
  registry: { has: (k) => snaps.has(k) },
  getBaseSnapshot: (k) => snaps.get(k) ?? null,
}
vi.mock('../../data/barStore/index', () => ({ getBarStore: () => fakeStore }))
vi.mock('./barStoreSwitch', () => ({ BARSTORE: true }))

const {
  prepareRow, neighborPlainOf, deriveSession, deriveOhlcBase, deriveClose, deriveVol, deriveVolMa, deriveHvc,
} = await import('./useNeighborFrames')
const { deriveCustomTf, customSpecOf } = await import('./customTfRows')
const { chartKeyFor } = await import('./useBarSnapshotBars')
const { legacyBars } = await import('../../data/barStore/adapter')
const { resampleForSpec } = await import('../../utils/resampleBars')
const nf = await import('./neighborFrames')
const { toChartTime } = await import('./barTime')

const adjustTime = (t) => (typeof t === 'number' ? toChartTime(t) : t)
function recipesFor(tf) {
  const at = nf.identitySig(adjustTime)
  const sessionP = { intradayLike: true, isIntraday: false, showExtended: false, tf }
  const closeP = { plain: true, mode: 'netchange', up: '#0f0', down: '#f00' }
  const volP = { blank: false, upC: '#1a1', downC: '#a11', netChange: true, dwm: false, liveVol: NaN, bold: false }
  return {
    adjustTime,
    session: { p: sessionP, sig: nf.stableSig(sessionP) },
    heikinAshi: false, hvcOn: true,
    ohlc: { sunrise: false, sig: `plain|at${at}` },
    close: { p: closeP, sig: `${nf.stableSig(closeP)}|at${at}` },
    vol: { on: true, p: volP, sig: `${nf.stableSig(volP)}|at${at}` },
    volMa: { on: true, period: 20, sig: `p${nf.stableSig(20)}|at${at}` },
    plain: true,
  }
}
// 60m regular-session rows (09:30 .. 15:30 ET, EST in November), weekdays 2026-11-02 .. 2026-11-25
function hourly(k = 1) {
  const out = []
  for (let d = 2; d <= 25; d++) {
    const dow = new Date(Date.UTC(2026, 10, d)).getUTCDay()
    if (dow === 0 || dow === 6) continue
    for (let h = 0; h < 7; h++) {
      const t = Math.floor(Date.UTC(2026, 10, d, 14 + h, 30) / 1000)
      const c = 50 + Math.sin((out.length + 1) / 7) * 4 * k
      out.push({ t, o: c - 0.3, h: c + 0.8, l: c - 0.9, c, v: 2e4 + (out.length * 37) % 911 })
    }
  }
  return out
}
const keyFor = (sym, tf) => chartKeyFor({ sym, resolvedTf: tf, showExtended: false, replayCutoff: null, hasOverride: false })

let prepared
let engineRef
beforeEach(() => {
  nf.__setNeighborFramesForTests(true)
  nf.__resetNeighborFramesStatsForTests()
  nf.__resetDerivedForTests()
  snaps.clear()
  prepared = []
  engineRef = { current: { binder: { prepare: function* (row) { prepared.push(row); yield } } } }
})
afterEach(() => nf.__setNeighborFramesForTests(null))

const drain = (g) => { for (const _ of g) { /* each piece */ } }

describe('deriveCustomTf', () => {
  it('is the resample of the base rows, the same array when asked again of the same rows', () => {
    const all = hourly()
    const spec = customSpecOf('240', false)
    const a = deriveCustomTf(all, spec)
    expect(a).toEqual(resampleForSpec(all, spec))
    expect(a.length).toBeGreaterThan(0)
    expect(deriveCustomTf(all, spec)).toBe(a)
    expect(nf.hasDerived(all, 'customTf', nf.stableSig(spec))).toBe(true)
  })

  it('another spec (the extended view, another timeframe) is another question', () => {
    const all = hourly()
    const a = deriveCustomTf(all, customSpecOf('240', false))
    const b = deriveCustomTf(all, customSpecOf('120', false))
    expect(b).not.toBe(a)
    expect(b).toEqual(resampleForSpec(all, customSpecOf('120', false)))
  })

  it('CONTROL: with the neighbour frames off nothing is filed, the old resample every time', () => {
    nf.__setNeighborFramesForTests(false)
    const all = hourly()
    const spec = customSpecOf('240', false)
    const a = deriveCustomTf(all, spec)
    expect(a).toEqual(resampleForSpec(all, spec))
    expect(deriveCustomTf(all, spec)).not.toBe(a)
  })
})

describe('prepareRow on a custom timeframe', () => {
  for (const tf of ['240', '120', '45']) {
    it(`${tf}: the arriving chart finds the resample and every derived array, and the binder gets the chart's bars`, () => {
      const key = keyFor('HHH', tf)
      // (a 45m chart reads the 15m base: the same rows serve, the resample decides the buckets)
      const s = Object.freeze({ key, tf: customSpecOf(tf, false).base, bars: hourly(), developing: null, baseRev: 2, status: 'current', restSeen: true })
      snaps.set(key, s)
      const R = recipesFor(tf)
      drain(prepareRow('HHH', 0, { recipes: () => R, view: () => ({ tf, showExtended: false }), engineRef }))
      // the chart, arriving: its bars are the resample of legacyBars(base snapshot), and every derivation is filed
      const all = legacyBars(s)
      const before = nf.neighborFramesStats().derivedHit
      const bars = deriveCustomTf(all, customSpecOf(tf, false))
      expect(bars).toEqual(resampleForSpec(all, customSpecOf(tf, false)))
      const filtered = deriveSession(bars, R)
      deriveOhlcBase(filtered, R)
      deriveClose(filtered, R)
      const h = deriveHvc(filtered, R)
      deriveVol(filtered, h, null, R)
      deriveVolMa(filtered, R)
      expect(nf.neighborFramesStats().derivedHit - before).toBe(7)
      expect(prepared).toHaveLength(1)
      expect(prepared[0].bars).toBe(filtered)
    })
  }

  it('CONTROL native: a 60m chart on the same base key is prepared from the base rows themselves', () => {
    const key = keyFor('HHH', '60')
    const s = Object.freeze({ key, tf: '60', bars: hourly(), developing: null, baseRev: 2, status: 'current', restSeen: true })
    snaps.set(key, s)
    const R = { ...recipesFor('60'), session: (() => { const p = { intradayLike: true, isIntraday: true, showExtended: false, tf: '60' }; return { p, sig: nf.stableSig(p) } })() }
    drain(prepareRow('HHH', 0, { recipes: () => R, view: () => ({ tf: '60', showExtended: false }), engineRef }))
    expect(prepared[0].bars).toBe(deriveSession(legacyBars(s), R))
  })
})

describe('neighborPlainOf', () => {
  const rows = []
  const plain = { hasOverride: false, isCustomTf: false, replayMode: false, replayIndex: null, replayCutoff: null, exactDateRange: null, sessionCandleActive: false, sessionBars: rows, filteredBars: rows, sessionAppliedBars: rows }
  it('a custom timeframe chart is on the plain path (its rows are prepared)', () => {
    expect(neighborPlainOf({ ...plain, isCustomTf: true })).toBe(true)
  })
  it('CONTROL: replay, an override, a framed range, a session candle or a chain of its own are not', () => {
    expect(neighborPlainOf(plain)).toBe(true)
    expect(neighborPlainOf({ ...plain, replayMode: true })).toBe(false)
    expect(neighborPlainOf({ ...plain, replayIndex: 3 })).toBe(false)
    expect(neighborPlainOf({ ...plain, replayCutoff: '2026-11-20' })).toBe(false)
    expect(neighborPlainOf({ ...plain, hasOverride: true })).toBe(false)
    expect(neighborPlainOf({ ...plain, exactDateRange: { from: 1, to: 2 } })).toBe(false)
    expect(neighborPlainOf({ ...plain, sessionCandleActive: true })).toBe(false)
    expect(neighborPlainOf({ ...plain, filteredBars: [] })).toBe(false)
    expect(neighborPlainOf({ ...plain, sessionAppliedBars: [] })).toBe(false)
  })
})
