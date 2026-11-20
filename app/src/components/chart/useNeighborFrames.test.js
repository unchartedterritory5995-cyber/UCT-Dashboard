// ⭐⭐ NEIGHBOR FRAMES — one row prepared (`prepareRow`): it reads the store's base snapshot the way the chart
// reads it, derives the chart's arrays through the chart's own recipes, hands the binder exactly the bars the
// chart will hand it, and touches nothing else (no subscribe, no request: the fake store has nothing else).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const snaps = new Map()
const fakeStore = {
  registry: { has: (k) => snaps.has(k) },
  getBaseSnapshot: (k) => snaps.get(k) ?? null,
}
vi.mock('../../data/barStore/index', () => ({ getBarStore: () => fakeStore }))

const { prepareRow, deriveSession, deriveOhlcBase, deriveClose, deriveVol, deriveVolMa, deriveHvc } = await import('./useNeighborFrames')
const { chartKeyFor } = await import('./useBarSnapshotBars')
const { legacyBars } = await import('../../data/barStore/adapter')
const nf = await import('./neighborFrames')
const { toChartTime } = await import('./barTime')

const adjustTime = (t) => (typeof t === 'number' ? toChartTime(t) : t)
const recipes = () => {
  const at = nf.identitySig(adjustTime)
  const sessionP = { intradayLike: false, isIntraday: false, showExtended: false, tf: 'D' }
  const closeP = { plain: true, mode: 'netchange', up: '#0f0', down: '#f00' }
  const volP = { blank: false, upC: '#1a1', downC: '#a11', netChange: true, dwm: true, liveVol: NaN, bold: false }
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
const daily = (n, k = 1) => Array.from({ length: n }, (_, i) => {
  const t = Math.floor(Date.UTC(2015, 0, 1) / 1000) + i * 86400
  const c = 50 + Math.sin(i / 9) * 5 * k
  return { t, o: c - 0.4, h: c + 1, l: c - 1, c, v: 1e5 + (i * 31) % 999 }
})
const R = recipes()
const view = { tf: 'D', showExtended: false }
const keyOf = (sym) => chartKeyFor({ sym, resolvedTf: 'D', showExtended: false, replayCutoff: null, hasOverride: false })

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
const ctx = () => ({ recipes: () => R, view: () => view, engineRef })

describe('prepareRow', () => {
  it('derives the chart\'s arrays from the very array the chart will hold, and hands the binder those bars', () => {
    const s = Object.freeze({ key: keyOf('BBB'), tf: 'D', bars: daily(400), developing: null, baseRev: 3, status: 'current', restSeen: true })
    snaps.set(keyOf('BBB'), s)
    drain(prepareRow('BBB', 0, ctx()))
    // the chart, arriving: its bars are legacyBars(base snapshot) and every derivation is already filed
    const bars = legacyBars(s)
    const before = nf.neighborFramesStats().derivedHit
    const filtered = deriveSession(bars, R)
    deriveOhlcBase(filtered, R)
    deriveClose(filtered, R)
    const h = deriveHvc(filtered, R)
    deriveVol(filtered, h, null, R)
    deriveVolMa(filtered, R)
    expect(nf.neighborFramesStats().derivedHit - before).toBe(6)
    expect(prepared).toHaveLength(1)
    expect(prepared[0].bars).toBe(filtered)
    expect(prepared[0].sym).toBe('BBB')
    expect(prepared[0].points).toBe(true)
  })

  it('a row two away gets its columns but not its points', () => {
    snaps.set(keyOf('CCC'), Object.freeze({ key: keyOf('CCC'), tf: 'D', bars: daily(100), developing: null, baseRev: 1, status: 'current', restSeen: true }))
    drain(prepareRow('CCC', 2, ctx()))
    expect(prepared[0].points).toBe(false)
  })

  it('a row the chart would not paint as it stands (provisional, empty, absent) is not prepared', () => {
    snaps.set(keyOf('PPP'), Object.freeze({ key: keyOf('PPP'), tf: 'D', bars: daily(100), developing: null, baseRev: 1, status: 'provisional' }))
    drain(prepareRow('PPP', 0, ctx()))
    drain(prepareRow('ZZZ', 0, ctx()))
    expect(prepared).toEqual([])
    expect(nf.neighborFramesStats().barsSkipped).toBe(2)
  })

  it('a chart off the plain path (replay, an override, a session candle…) prepares nothing', () => {
    snaps.set(keyOf('BBB'), Object.freeze({ key: keyOf('BBB'), tf: 'D', bars: daily(100), developing: null, baseRev: 1, status: 'current' }))
    drain(prepareRow('BBB', 0, { ...ctx(), recipes: () => ({ ...R, plain: false }) }))
    expect(prepared).toEqual([])
  })
})
