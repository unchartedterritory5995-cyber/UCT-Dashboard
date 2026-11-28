// The double buffer's bars proof, by the chart's own path (review of #2922, N2; chart/useDoubleBuffer.js barsNowFor):
//   B1 a native timeframe: the base snapshot's rows (adapter.legacyBars, memoised per snapshot)
//   B2 a CUSTOM timeframe (4h over its 60m base): the FILED resample (customTfRows.deriveCustomTf), the very array the
//      chart's hook holds, so a 4h / 2h / 45m shadow can prove its bars and flip; a new base snapshot is another array
//   B3 W / M whose own key is still empty: the filed resample of the held DAILY rows (deriveWmFromDaily), as the hook's
//      `_aggBars`; once the W key holds its own rows, those
//   B4 (owner, 2026-11-27: change-date mode) under a replay cutoff: an intraday chart's own window (the key ENDING at the
//      cutoff), never the plain key's rows; a daily chart reads the plain key (StockChart cuts every bar after it)
//   B5 (owner, 2026-11-27: the date the member went to) under a date-box anchor: an intraday chart reads the window ending
//      at the date (chartKeyFor viewWindow), a daily chart the plain key; a replay's own window wins
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const base = new Map()   // key -> base snapshot
const state = new Map()  // key -> latest snapshot (peek)
const fakeStore = {
  registry: { has: (k) => base.has(k) },
  getBaseSnapshot: (k) => base.get(k) ?? null,
  peek: (k) => state.get(k) ?? base.get(k) ?? null,
}
vi.mock('../../data/barStore/index', () => ({ getBarStore: () => fakeStore }))
vi.mock('./barStoreSwitch', () => ({ BARSTORE: true }))

const { barsNowFor } = await import('./useDoubleBuffer')
const { chartKeyFor } = await import('./useBarSnapshotBars')
const { legacyBars } = await import('../../data/barStore/adapter')
const { keyOf } = await import('../../data/barStore/types')
const { deriveCustomTf, customSpecOf, deriveWmFromDaily } = await import('./customTfRows')
const nf = await import('./neighborFrames')

const ck = (sym, tf) => chartKeyFor({ sym, resolvedTf: tf, showExtended: false, replayCutoff: null, hasOverride: false })
const snapOf = (key, tf, bars) => Object.freeze({ key, tf, bars, developing: null, baseRev: Math.random(), status: 'current', restSeen: true })
const daily = (n) => Array.from({ length: n }, (_, i) => {
  const t = Math.floor(Date.UTC(2026, 0, 5) / 1000) + i * 86400
  return { t, o: 10 + i, h: 11 + i, l: 9 + i, c: 10.5 + i, v: 1000 + i }
})
const hourly = () => {
  const out = []
  for (let d = 2; d <= 13; d++) {
    const dow = new Date(Date.UTC(2026, 10, d)).getUTCDay()
    if (dow === 0 || dow === 6) continue
    for (let h = 0; h < 7; h++) {
      const c = 50 + out.length * 0.1
      out.push({ t: Math.floor(Date.UTC(2026, 10, d, 14 + h, 30) / 1000), o: c, h: c + 1, l: c - 1, c, v: 100 })
    }
  }
  return out
}

beforeEach(() => { base.clear(); state.clear(); nf.__setNeighborFramesForTests(true); nf.__resetDerivedForTests() })
afterEach(() => nf.__setNeighborFramesForTests(null))

describe('barsNowFor (N2)', () => {
  it('B4 (owner) under a replay cutoff: an intraday chart reads its window ending at the cutoff, a daily chart the plain key', () => {
    const cutoff = '2006-03-15'
    const win = chartKeyFor({ sym: 'AAA', resolvedTf: '5', showExtended: false, replayCutoff: cutoff, hasOverride: false })
    expect(win).not.toBe(ck('AAA', '5'))
    const sw = snapOf(win, '5', daily(10)), sp = snapOf(ck('AAA', '5'), '5', daily(20))
    base.set(win, sw); base.set(ck('AAA', '5'), sp)
    expect(barsNowFor({ sym: 'AAA', tf: '5', ext: false, cutoff })).toBe(legacyBars(sw))
    expect(barsNowFor({ sym: 'AAA', tf: '5', ext: false })).toBe(legacyBars(sp))
    const sd = snapOf(ck('AAA', 'D'), 'D', daily(30))
    base.set(ck('AAA', 'D'), sd)
    expect(barsNowFor({ sym: 'AAA', tf: 'D', ext: false, cutoff })).toBe(legacyBars(sd))
  })

  it('B5 (owner) under a date anchor: an intraday chart reads the window at the date, a daily chart the plain key', async () => {
    const { viewWindowOfDate } = await import('./useBarSnapshotBars')
    const vw = viewWindowOfDate('2006-01-03', '15')
    expect(vw).toBeTruthy()
    expect(viewWindowOfDate('2006-01-03', 'D')).toBe(null)
    const win = chartKeyFor({ sym: 'AAA', resolvedTf: '15', showExtended: false, replayCutoff: null, hasOverride: false, viewWindow: vw })
    expect(win).not.toBe(ck('AAA', '15'))
    expect(chartKeyFor({ sym: 'AAA', resolvedTf: '15', showExtended: false, replayCutoff: '2006-01-03', hasOverride: false })).toBe(win)   // the same window a replay at that date reads
    expect(chartKeyFor({ sym: 'AAA', resolvedTf: 'D', showExtended: false, replayCutoff: null, hasOverride: false, viewWindow: vw })).toBe(ck('AAA', 'D'))
    const sw = snapOf(win, '15', daily(10)), sp = snapOf(ck('AAA', '15'), '15', daily(20))
    base.set(win, sw); base.set(ck('AAA', '15'), sp)
    expect(barsNowFor({ sym: 'AAA', tf: '15', ext: false, anchor: '2006-01-03|120' })).toBe(legacyBars(sw))
    expect(barsNowFor({ sym: 'AAA', tf: '15', ext: false })).toBe(legacyBars(sp))
  })

  it('B1 a native timeframe: the base snapshot\'s rows', () => {
    const s = snapOf(ck('AAA', 'D'), 'D', daily(30))
    base.set(ck('AAA', 'D'), s)
    expect(barsNowFor({ sym: 'AAA', tf: 'D', ext: false })).toBe(legacyBars(s))
  })

  it('B2 a custom timeframe: the filed resample of its base rows, the very array the chart holds; a new snapshot is another', () => {
    const key = ck('HHH', '240')
    const s = snapOf(key, '60', hourly())
    base.set(key, s)
    const chartBars = deriveCustomTf(legacyBars(s), customSpecOf('240', false))   // what the chart's hook holds
    expect(chartBars.length).toBeGreaterThan(0)
    expect(barsNowFor({ sym: 'HHH', tf: '240', ext: false })).toBe(chartBars)
    base.set(key, snapOf(key, '60', hourly()))                                    // the base moved on
    expect(barsNowFor({ sym: 'HHH', tf: '240', ext: false })).not.toBe(chartBars)
  })

  it('B3 W with its own key empty: the filed weekly resample of the held daily rows; with its own rows, those', () => {
    const d = snapOf(keyOf({ sym: 'WWW', tf: 'D' }), 'D', daily(60))
    state.set(keyOf({ sym: 'WWW', tf: 'D' }), d)
    base.set(ck('WWW', 'W'), snapOf(ck('WWW', 'W'), 'W', []))
    const chartBars = deriveWmFromDaily(legacyBars(d), 'W')
    expect(chartBars.length).toBeGreaterThan(0)
    expect(barsNowFor({ sym: 'WWW', tf: 'W', ext: false })).toBe(chartBars)
    const own = snapOf(ck('WWW', 'W'), 'W', daily(10))
    base.set(ck('WWW', 'W'), own)
    expect(barsNowFor({ sym: 'WWW', tf: 'W', ext: false })).toBe(legacyBars(own))
  })
})
