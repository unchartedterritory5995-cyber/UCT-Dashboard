// ⭐ (lane C, zero-network PR 1.5, goal A4) THE CHART'S OWN SYMBOL AT ITS HABITUAL NEXT TIMEFRAMES. After a chart paints,
// the neighbour preparer also prepares the SAME symbol at the member's top-2 habitual timeframes (tfHabit.js): the bars
// the chart would hold there (a custom code resampled from its base) and the derived arrays, filed under those bars, so a
// timeframe press finds them. Never the binder (its instances are the current timeframe's), never the 'next' row hold.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

const snaps = new Map()
const fakeStore = {
  registry: { has: (k) => snaps.has(k), subscribe: () => () => {} },
  getBaseSnapshot: (k) => snaps.get(k) ?? null,
}
vi.mock('../../data/barStore/index', () => ({ getBarStore: () => fakeStore }))
vi.mock('./barStoreSwitch', () => ({ BARSTORE: true }))
const scheduled = []
vi.mock('./neighborFrames', async (orig) => {
  const real = await orig()
  return { ...real, idleSupported: () => true, scheduleIdle: (owner, rank, gen) => { scheduled.push({ owner, rank, gen }) } }
})

const { prepareRow, useNeighborFrames, PREPARE_RANKS } = await import('./useNeighborFrames')
const { deriveCustomTf, customSpecOf } = await import('./customTfRows')
const { chartKeyFor } = await import('./useBarSnapshotBars')
const { legacyBars } = await import('../../data/barStore/adapter')
const nf = await import('./neighborFrames')
const { toChartTime } = await import('./barTime')
const { noteTfPress, __resetTfHabitForTests } = await import('./tfHabit')

const adjustTime = (t) => (typeof t === 'number' ? toChartTime(t) : t)
function recipes() {
  const at = nf.identitySig(adjustTime)
  const sessionP = { intradayLike: true, isIntraday: false, showExtended: false, tf: 'D' }
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
function hourly() {
  const out = []
  for (let d = 2; d <= 25; d++) {
    const dow = new Date(Date.UTC(2026, 10, d)).getUTCDay()
    if (dow === 0 || dow === 6) continue
    for (let h = 0; h < 7; h++) {
      const t = Math.floor(Date.UTC(2026, 10, d, 14 + h, 30) / 1000)
      const c = 50 + Math.sin((out.length + 1) / 7) * 4
      out.push({ t, o: c - 0.3, h: c + 0.8, l: c - 0.9, c, v: 2e4 + (out.length * 37) % 911 })
    }
  }
  return out
}
const keyFor = (sym, tf) => chartKeyFor({ sym, resolvedTf: tf, showExtended: false, replayCutoff: null, hasOverride: false })
const drain = (g) => { for (const _ of g) { /* each piece */ } }

let prepared, engineRef
beforeEach(() => {
  nf.__setNeighborFramesForTests(true)
  nf.__resetNeighborFramesStatsForTests()
  nf.__resetDerivedForTests()
  __resetTfHabitForTests()
  snaps.clear()
  scheduled.length = 0
  prepared = []
  engineRef = { current: { binder: { prepare: function* (row) { prepared.push(row); yield } } } }
})
afterEach(() => nf.__setNeighborFramesForTests(null))

describe('prepareRow at another timeframe (tfAt)', () => {
  it('a daily chart prepares its own symbol at 4h: the 4h resample of the base rows is filed, the binder is not asked', () => {
    const key = keyFor('HHH', '240')
    const s = Object.freeze({ key, tf: '60', bars: hourly(), developing: null, baseRev: 2, status: 'current', restSeen: true })
    snaps.set(key, s)
    drain(prepareRow('HHH', PREPARE_RANKS, { recipes, view: () => ({ tf: 'D', showExtended: false }), engineRef, owner: {} }, '240'))
    expect(nf.hasDerived(legacyBars(s), 'customTf', nf.stableSig(customSpecOf('240', false)))).toBe(true)
    expect(nf.neighborFramesStats().barsPrepared).toBe(1)
    expect(prepared).toHaveLength(0)
    // and what it filed is what the arriving 4h chart derives
    expect(deriveCustomTf(legacyBars(s), customSpecOf('240', false)).length).toBeGreaterThan(0)
  })

  it('CONTROL: without tfAt the chart\'s own timeframe (D) is read, and a store without it prepares nothing', () => {
    snaps.set(keyFor('HHH', '240'), Object.freeze({ key: keyFor('HHH', '240'), tf: '60', bars: hourly(), developing: null, baseRev: 2, status: 'current', restSeen: true }))
    drain(prepareRow('HHH', PREPARE_RANKS, { recipes, view: () => ({ tf: 'D', showExtended: false }), engineRef, owner: {} }))
    expect(nf.neighborFramesStats().barsPrepared || 0).toBe(0)
    expect(nf.neighborFramesStats().barsSkipped).toBe(1)
  })
})

describe('useNeighborFrames schedules the habitual timeframes', () => {
  it('after the paint, the chart own symbol at its top-2 habitual timeframes (custom codes on its bar), after the neighbour ranks', async () => {
    noteTfPress('D', '240'); noteTfPress('D', '240'); noteTfPress('D', '45')
    for (const tf of ['240', '45']) snaps.set(keyFor('HHH', tf), Object.freeze({ key: keyFor('HHH', tf), tf: '60', bars: hourly(), developing: null, baseRev: 2, status: 'current', restSeen: true }))
    vi.useFakeTimers()
    try {
      renderHook(() => useNeighborFrames({ on: true, sym: 'HHH', tf: 'D', showExtended: false, engineRef, recipes: recipes(), tfBar: ['5', '45', '60', '240', 'D', 'W'] }))
      vi.advanceTimersByTime(50)   // the requestAnimationFrame after the paint
      expect(scheduled.map((x) => x.rank)).toEqual([PREPARE_RANKS, PREPARE_RANKS + 1])
      // WHICH timeframes: the member's 4h, then 45m (review of #2996, F2: TF_ORDER alone filtered them out)
      const read = []
      const orig = fakeStore.getBaseSnapshot
      fakeStore.getBaseSnapshot = (k) => { read.push(k); return orig(k) }
      try { for (const x of scheduled) drain(x.gen) } finally { fakeStore.getBaseSnapshot = orig }
      expect(read).toEqual([keyFor('HHH', '240'), keyFor('HHH', '45')])
    } finally { vi.useRealTimers() }
  })

  it('CONTROL: no history: the bar neighbours of D (W, then 60)', () => {
    vi.useFakeTimers()
    try {
      snaps.set(keyFor('HHH', 'W'), Object.freeze({ key: keyFor('HHH', 'W'), tf: 'W', bars: hourly(), developing: null, baseRev: 2, status: 'current', restSeen: true }))
      renderHook(() => useNeighborFrames({ on: true, sym: 'HHH', tf: 'D', showExtended: false, engineRef, recipes: recipes() }))
      vi.advanceTimersByTime(50)
      expect(scheduled.map((x) => x.rank)).toEqual([PREPARE_RANKS, PREPARE_RANKS + 1])
      drain(scheduled[0].gen)
      expect(nf.neighborFramesStats().barsPrepared).toBe(1)   // W was the first neighbour, and its bars are held
    } finally { vi.useRealTimers() }
  })
})
