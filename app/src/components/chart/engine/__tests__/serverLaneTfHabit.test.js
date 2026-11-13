// app/src/components/chart/engine/__tests__/serverLaneTfHabit.test.js
//
// ─── THE FIRST SWITCH TO A TIMEFRAME THE MEMBER USES ─────────────────────────
//
// Measured on production 2026-11-13 (a daily chart with the RS suite, switched to weekly and
// back): the first switch to weekly drew its RS lines 1,150 ms after its candles, every later
// one in the candles' frame. Nothing could be asked ahead for weekly, because `liveAsks('W')`
// is empty until a weekly chart has painted once in the page load.
//
// The lane now remembers, in this browser, which of D / W / M a member draws server columns
// on. For the ONE symbol a member rests on, the pre-load asks at such a timeframe with what
// the board's other daily-family charts are drawing (`habitAsks`). These rails pin the habit,
// its bounds, and everything that must NOT borrow.
//
// ⚰️ THE FIRST CUT WAS GREEN HERE AND NEVER RAN FOR A MEMBER. It answered from the habit only
// for one symbol asked for BY PRIORITY, and these tests called the warmer that way. The
// announcement it was built for is the watchlist's `prefetchAllTimeframes(sym)` once a
// selection rests, which tells one symbol at each timeframe WITHOUT priority. Measured on
// production with that cut live: the first switch to weekly 1,000 and 1,833 ms behind its
// candles, and no weekly request before the click. The last block below drives that call
// itself, through the bars prefetch's own registry.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  ASK_TTL_MS, TF_HABIT_KEY, TF_HABIT_MS, TF_HABIT_WRITE_MS,
  clearServerColumns, liveAsks, habitAsks, serverColumnsFor, __setServerBatchFetcherForTests,
} from '../serverCompute'
import { warmSymbols, armServerWarm, serverWarmStats, __resetServerWarm, ACTIVE_MAX, ACTIVE_MAX_NEAR } from '../serverWarm'
import { prefetchAllTimeframes, prefetchBarsToIDB } from '../../../../utils/prefetchBars'

vi.mock('../../../../hooks/useTickerMeta', () => ({ prefetchTickerMeta: vi.fn() }))

const never = () => new Promise(() => {})
const def = (id) => ({ id, compute: { kind: 'server' }, plots: [], meta: {} })
const bars = [{ t: '2026-01-02' }]
/** a chart paints definition `id` with `inputs` on `sym` at `tf` */
const paint = (id, tf, inputs = { benchmark: 'SPY' }, sym = 'NVDA') => serverColumnsFor(def(id), bars, inputs, { sym, tf, fetcher: never })
const habit = () => JSON.parse(localStorage.getItem(TF_HABIT_KEY) || 'null')
/** a new page load: nothing in memory, the same browser storage */
const newPageLoad = () => clearServerColumns()
/** this browser's member drew server columns on weekly `ago` ms ago */
const usedWeekly = (ago = 0) => { localStorage.setItem(TF_HABIT_KEY, JSON.stringify({ W: Date.now() - ago })); newPageLoad() }

let urls
const armWarm = () => {
  __resetServerWarm({ painted: true })
  urls = []
  __setServerBatchFetcherForTests((url) => { urls.push(url); return never() })
}
const asked = () => urls.map((u) => { const q = new URL(u, 'http://x').searchParams; return `${q.get('sym')}@${q.get('tf')}:${JSON.parse(q.get('asks')).map((a) => a.defId).join('+')}` })

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.removeItem(TF_HABIT_KEY)
  localStorage.setItem('barspack.version', 'x')          // the bars pack is held: background rows are not parked
  clearServerColumns()
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('no network in this suite') }))
})
afterEach(() => {
  __setServerBatchFetcherForTests(null)
  clearServerColumns()
  __resetServerWarm()
  localStorage.removeItem(TF_HABIT_KEY)
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('the habit: which of D / W / M this member draws server columns on', () => {
  it('a paint remembers its timeframe in this browser, and only that', () => {
    paint('rsLine', 'D')
    expect(habit()).toEqual({ D: Date.now() })
    paint('rsPhases', 'W')
    expect(habit()).toEqual({ D: Date.now(), W: Date.now() })
  })

  it('an intraday timeframe is never remembered', () => {
    paint('rsLine', '5')
    paint('rsLine', '60')
    paint('rsLine', '1')
    expect(habit()).toBeNull()
  })

  it('it is written once per timeframe per hour, not on every paint', async () => {
    expect(TF_HABIT_WRITE_MS).toBe(60 * 60_000)
    const set = vi.spyOn(Storage.prototype, 'setItem')
    const writes = () => set.mock.calls.filter((c) => c[0] === TF_HABIT_KEY).length
    try {
      for (let i = 0; i < 50; i++) paint('rsLine', 'W')
      expect(writes()).toBe(1)
      paint('rsLine', 'D')
      expect(writes(), 'another timeframe is another write').toBe(2)
      await vi.advanceTimersByTimeAsync(TF_HABIT_WRITE_MS - 1)
      paint('rsLine', 'W')
      expect(writes()).toBe(2)
      await vi.advanceTimersByTimeAsync(1)
      paint('rsLine', 'W')
      expect(writes()).toBe(3)
      expect(habit().W, 'and what is written is when it was last used').toBe(Date.now())
      expect(Object.keys(habit()).sort()).toEqual(['D', 'W'])
    } finally { set.mockRestore() }
  })
})

describe('⭐ what a habit timeframe would ask for, before its first paint of the page load', () => {
  it('the asks the board\'s other daily-family charts are drawing, one per definition and inputs', () => {
    usedWeekly()
    expect(habitAsks('W'), 'nothing drawn yet in this page load: nothing to borrow').toEqual([])
    paint('rsLine', 'D', { benchmark: 'QQQ' })
    paint('rsPhases', 'D', { benchmark: 'QQQ' })
    paint('rsLine', 'M', { benchmark: 'QQQ' })
    paint('rsLine', 'D', { benchmark: 'SPY' })
    expect(habitAsks('W')).toEqual([
      { defId: 'rsLine', inputs: { benchmark: 'QQQ' } }, { defId: 'rsPhases', inputs: { benchmark: 'QQQ' } }, { defId: 'rsLine', inputs: { benchmark: 'SPY' } },
    ])
  })

  it('⛔ `liveAsks` never borrows: a whole list is only warmed at a timeframe a chart really draws', () => {
    usedWeekly()
    paint('rsLine', 'D')
    expect(liveAsks('W')).toEqual([])
    expect(liveAsks('D').length).toBe(1)
  })

  it('a member with no habit for the timeframe is asked for nothing', () => {
    usedWeekly()
    paint('rsLine', 'D')
    expect(habitAsks('M')).toEqual([])
    localStorage.removeItem(TF_HABIT_KEY)
    newPageLoad()
    paint('rsLine', 'D')
    expect(habitAsks('W')).toEqual([])
  })

  it('the moment a real ask is noted at the timeframe, nothing is borrowed', () => {
    usedWeekly()
    paint('rsLine', 'D')
    paint('rsPhases', 'D')
    expect(habitAsks('W').length).toBe(2)
    paint('rsVsEma', 'W', { benchmark: 'IWM' })
    expect(habitAsks('W')).toEqual([])
    expect(liveAsks('W')).toEqual([{ defId: 'rsVsEma', inputs: { benchmark: 'IWM' } }])
  })

  it('an intraday timeframe never borrows and is never borrowed from', () => {
    localStorage.setItem(TF_HABIT_KEY, JSON.stringify({ 5: Date.now(), W: Date.now() }))
    newPageLoad()
    paint('rsLine', 'D')
    expect(habitAsks('5'), 'whatever storage says').toEqual([])
    expect(habitAsks('W').length).toBe(1)
    newPageLoad()
    paint('rsLine', '5')
    expect(habitAsks('W'), 'an intraday chart\'s asks are not weekly\'s').toEqual([])
  })

  it('an ask no paint has made for a while is not borrowed', async () => {
    usedWeekly()
    paint('rsLine', 'D')
    await vi.advanceTimersByTimeAsync(ASK_TTL_MS - 1)
    expect(habitAsks('W').length).toBe(1)
    await vi.advanceTimersByTimeAsync(2)
    expect(habitAsks('W')).toEqual([])
  })

  it('a habit lasts TF_HABIT_MS from its last use, and one dated in the future is not a habit', () => {
    expect(TF_HABIT_MS).toBe(14 * 24 * 60 * 60_000)
    const at = (ago) => { usedWeekly(ago); paint('rsLine', 'D'); return habitAsks('W').length }
    expect(at(TF_HABIT_MS), 'exactly at the limit').toBe(1)
    expect(at(TF_HABIT_MS + 1), 'one millisecond past it').toBe(0)
    expect(at(-60_000), 'a clock that moved').toBe(0)
    expect(at(0), 'now').toBe(1)
  })

  it('storage that is not ours, or not there, is simply no habit', () => {
    for (const junk of ['not json', '[]', '"W"', '7', 'null', JSON.stringify({ W: 'yesterday' }), JSON.stringify({ W: null }), JSON.stringify({ W: true })]) {
      localStorage.setItem(TF_HABIT_KEY, junk)
      newPageLoad()
      paint('rsLine', 'D')
      expect(habitAsks('W'), junk).toEqual([])
    }
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full') })
    try {
      newPageLoad()
      expect(() => paint('rsLine', 'D')).not.toThrow()
      expect(liveAsks('D').length, 'the real ask is still noted').toBe(1)
      expect(habitAsks('W')).toEqual([])
    } finally { get.mockRestore(); set.mockRestore() }
  })
})

describe('⭐ the pre-load asks at a habit timeframe for the ONE symbol the member rests on', () => {
  it('a rested symbol\'s weekly columns are asked for, with the daily chart\'s asks', async () => {
    usedWeekly()
    armWarm()
    paint('rsLine', 'D')
    paint('rsPhases', 'D')
    expect(warmSymbols(['NVDA'], 'W', { priority: true })).toBe(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(asked()).toEqual(['NVDA@W:rsLine+rsPhases'])
  })

  it('⛔ a member with no weekly habit costs the server nothing for weekly', async () => {
    armWarm()
    paint('rsLine', 'D')
    expect(warmSymbols(['NVDA'], 'W', { priority: true })).toBe(0)
    await vi.advanceTimersByTimeAsync(1000)
    expect(asked()).toEqual([])
  })

  it('⛔ rows ahead and a whole list are never warmed from a habit: only ONE symbol, however it was announced', async () => {
    usedWeekly()
    armWarm()
    paint('rsLine', 'D')
    expect(warmSymbols(['NVDA', 'AAPL'], 'W', { priority: true }), 'two rows ahead').toBe(0)
    expect(warmSymbols(['NVDA', 'AAPL'], 'W', {}), 'two symbols, in the background').toBe(0)
    expect(warmSymbols(['NVDA', 'AAPL', 'MSFT'], 'W', { visible: true }), 'a list opening').toBe(0)
    expect(warmSymbols(Array.from({ length: 40 }, (_, i) => `S${i}`), 'W', {}), 'the rest of a list').toBe(0)
    await vi.advanceTimersByTimeAsync(1000)
    expect(asked()).toEqual([])
    expect(warmSymbols(['NVDA'], 'W', {}), 'control: the rested symbol, as the bars prefetch announces it').toBe(1)
    expect(warmSymbols(['AAPL'], 'W', { priority: true }), 'control: a hovered or typed one').toBe(1)
  })

  it('a timeframe a chart really draws is warmed exactly as before, for any call', async () => {
    usedWeekly()
    armWarm()
    paint('rsLine', 'D')
    paint('rsVsEma', 'W')
    // (NVDA's own weekly ask is already out: the chart painted it)
    expect(warmSymbols(['AAPL', 'MSFT'], 'W', { priority: true })).toBe(2)
    await vi.advanceTimersByTimeAsync(1000)
    expect(asked().sort(), 'weekly\'s own ask, not daily\'s').toEqual(['AAPL@W:rsVsEma', 'MSFT@W:rsVsEma'])
  })

  it('a symbol whose habit columns are already here is not asked for again', async () => {
    usedWeekly()
    armWarm()
    paint('rsLine', 'D')
    expect(warmSymbols(['NVDA'], 'W', { priority: true })).toBe(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(warmSymbols(['NVDA'], 'W', { priority: true }), 'on its way').toBe(0)
    expect(asked().length).toBe(1)
  })
})

describe('⭐ reached by the announcement the app really makes', () => {
  /** as the chart module does at load: the warmer is on the bars prefetch's registry */
  const armed = () => { armServerWarm(); armWarm() }

  it('the watchlist\'s own call once a selection rests gets the rested symbol its weekly columns', async () => {
    usedWeekly()
    armed()
    paint('rsLine', 'D')
    paint('rsPhases', 'D')
    prefetchAllTimeframes('NVDA')                         // pages/Watchlists.jsx, SCAN_DWELL_MS after the last key
    await vi.advanceTimersByTimeAsync(1000)
    expect(asked()).toEqual(['NVDA@W:rsLine+rsPhases'])
  })

  it('CONTROL: the same call for a member with no weekly habit asks the server for nothing', async () => {
    armed()
    paint('rsLine', 'D')
    prefetchAllTimeframes('NVDA')
    await vi.advanceTimersByTimeAsync(1000)
    expect(asked()).toEqual([])
  })

  it('CONTROL: a list announced at weekly through the same door is not warmed from the habit', async () => {
    usedWeekly()
    armed()
    paint('rsLine', 'D')
    prefetchBarsToIDB(['NVDA', 'AAPL', 'MSFT'], 'W')
    prefetchBarsToIDB(['NVDA', 'AAPL'], 'W', { priority: true })
    await vi.advanceTimersByTimeAsync(1000)
    expect(asked()).toEqual([])
  })

  it('it does not wait behind a list\'s background rows: it is the symbol on screen', async () => {
    usedWeekly()
    armed()
    paint('rsLine', 'D')
    warmSymbols(Array.from({ length: 40 }, (_, i) => `S${i}`), 'D', {})     // the rest of a list, in the background
    await vi.advanceTimersByTimeAsync(2000)
    expect(asked().length, 'the background rows hold their two slots').toBe(ACTIVE_MAX)
    prefetchAllTimeframes('NVDA')
    await vi.advanceTimersByTimeAsync(0)
    expect(asked().length).toBe(ACTIVE_MAX_NEAR)
    expect(asked()[ACTIVE_MAX_NEAR - 1], 'sent at once, on the slot kept for a near row').toBe('NVDA@W:rsLine')
  })

  it('the rows ahead stay "near": the rested symbol\'s ask goes in front of them without demoting them', async () => {
    usedWeekly()
    armed()
    paint('rsLine', 'D')
    warmSymbols(['R1', 'R2', 'R3', 'R4'], 'D', { priority: true })           // three go out, R4 waits as a near row
    expect(serverWarmStats()).toMatchObject({ active: ACTIVE_MAX_NEAR, queued: 1, near: 1 })
    prefetchAllTimeframes('NVDA')
    expect(serverWarmStats()).toMatchObject({ active: ACTIVE_MAX_NEAR, queued: 2, near: 2 })
  })

  it('a timeframe a chart on the board really draws keeps its place in the queue, as before', async () => {
    armed()
    paint('rsLine', 'D')
    paint('rsVsEma', 'W', { benchmark: 'SPY' }, 'SPY')                        // another chart draws at weekly
    warmSymbols(Array.from({ length: 40 }, (_, i) => `S${i}`), 'D', {})
    await vi.advanceTimersByTimeAsync(2000)
    expect(asked().length).toBe(ACTIVE_MAX)
    prefetchAllTimeframes('NVDA')
    await vi.advanceTimersByTimeAsync(0)
    expect(asked().length, 'a background row like any other: it waits its turn').toBe(ACTIVE_MAX)
    expect(serverWarmStats().near).toBe(0)
  })
})
