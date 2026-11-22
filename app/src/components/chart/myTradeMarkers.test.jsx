// @vitest-environment jsdom
// Chart Settings → Markers → Your activity → My trades: which fills are read, which bar each lands on (intraday, daily,
// weekly, monthly, DST, extended hours), how a bar's fills read, and that nothing is fetched while OFF.
// Synthetic symbols, prices, sizes and dates only — no real trades.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { toChartTime } from './barTime'
import {
  parseFillTime, fillsFrom, fillBarTime, buildMyTradeMarkers, barFillsTitle, fillTitle, mutedTone, sameMyTrades,
  withMyTradeMarkers, useMyTradeFills, myTradesUrl, MY_TRADES_POSITIONS_KEY, MY_TRADE_ID_PREFIX, EMPTY_MY_TRADES,
} from './myTradeMarkers'

// unix seconds for an ET wall-clock moment, given the ET offset in hours that day (-5 EST, -4 EDT)
const et = (y, mo, d, h, mi, off) => Math.floor(Date.UTC(y, mo - 1, d, h - off, mi) / 1000)
const iso = (unix) => new Date(unix * 1000).toISOString()
// an intraday series: every `step` minutes from h0:m0 to h1:m1 ET on one day, as chart times (what the candle series holds)
const day = (y, mo, d, off, [h0, m0], [h1, m1], step) => {
  const out = []
  for (let t = et(y, mo, d, h0, m0, off); t < et(y, mo, d, h1, m1, off); t += step * 60) out.push({ time: toChartTime(t) })
  return out
}
const at = (raw) => parseFillTime(raw)
const fill = (side, qty, price, raw) => ({ side, qty, price, at: parseFillTime(raw) })

describe('parseFillTime — the journal timestamp conventions', () => {
  it('a bare date and an exact UTC midnight are date-only (the journal\'s own rule)', () => {
    expect(parseFillTime('2031-04-15')).toEqual({ unix: null, date: '2031-04-15', dateOnly: true })
    expect(parseFillTime('2031-04-15T00:00:00Z')).toEqual({ unix: null, date: '2031-04-15', dateOnly: true })
    expect(parseFillTime('2031-04-15T00:00:00+00:00').dateOnly).toBe(true)
  })
  it('a timed fill keeps its instant and its ET date; a naive string is UTC', () => {
    const u = et(2031, 4, 15, 10, 31, -4)
    expect(parseFillTime(iso(u))).toEqual({ unix: u, date: '2031-04-15', dateOnly: false })
    expect(parseFillTime(iso(u).replace('Z', ''))).toEqual({ unix: u, date: '2031-04-15', dateOnly: false })
    expect(parseFillTime('2031-04-15T10:31:00-04:00').unix).toBe(u)
    // 22:00 ET is already the next day in UTC: the ET date wins
    expect(parseFillTime(iso(et(2031, 4, 15, 22, 0, -4))).date).toBe('2031-04-15')
  })
  it('junk is null', () => {
    for (const v of [null, '', 'soon', 42, undefined]) expect(parseFillTime(v), String(v)).toBe(null)
  })
})

describe('fillsFrom — the member\'s fills on exactly this symbol', () => {
  const trade = (over = {}) => ({ id: 't1', symbol: 'TSTA', side: 'Long', shares: 100, entryPrice: 10.5, entryDate: '2031-04-15T14:31:00Z', exitPrice: 11.25, exitDate: '2031-04-16T15:00:00Z', ...over })
  it('a long trade is a buy then a sell; a short is a sell then a buy', () => {
    const f = fillsFrom({ trades: [trade(), trade({ id: 't2', side: 'Short', shares: 50 })] }, null, 'TSTA')
    expect(f.map((x) => `${x.side}:${x.qty}@${x.price}`)).toEqual(['buy:100@10.5', 'sell:100@11.25', 'sell:50@10.5', 'buy:50@11.25'])
  })
  it('exact symbol only: the journal\'s prefix neighbours are dropped; case and spaces do not matter', () => {
    const body = { trades: [trade({ symbol: 'TSTAB' }), trade({ symbol: ' tsta ' }), trade({ symbol: 'TST' })] }
    expect(fillsFrom(body, null, 'tsta')).toHaveLength(2)
    expect(fillsFrom(body, null, 'TSTZ')).toEqual([])
    expect(fillsFrom(body, null, '')).toEqual([])
  })
  it('an open position adds its entry leg; an estimated entry, a zero price or a bad date is skipped', () => {
    const pos = (over = {}) => ({ symbol: 'TSTA', side: 'Long', shares: 40, entryPrice: 9.9, entryDate: '2031-04-14T14:00:00Z', ...over })
    const f = fillsFrom(null, { positions: [pos(), pos({ entryEstimated: true }), pos({ entryPrice: 0 }), pos({ entryDate: 'x' }), pos({ side: 'Short', shares: 7 })] }, 'TSTA')
    expect(f.map((x) => `${x.side}:${x.qty}`)).toEqual(['buy:40', 'sell:7'])
  })
  it('a missing / failed body reads as no fills', () => {
    expect(fillsFrom(undefined, undefined, 'TSTA')).toEqual([])
    expect(fillsFrom({ detail: 'nope' }, [], 'TSTA')).toEqual([])
  })
})

describe('fillBarTime — fill → the loaded bar it happened in', () => {
  // Fri 2031-03-07 is EST (-5); Mon 2031-03-10 is EDT (-4) — the US DST switch is Sun 2031-03-09.
  const fri5 = day(2031, 3, 7, -5, [9, 30], [16, 0], 5)
  const mon5 = day(2031, 3, 10, -4, [9, 30], [16, 0], 5)
  const bars5 = [...fri5, ...mon5]

  it('intraday: the bucket holding the fill, either side of the DST switch', () => {
    expect(fillBarTime(at(iso(et(2031, 3, 7, 10, 31, -5))), bars5, '5')).toBe(toChartTime(et(2031, 3, 7, 10, 30, -5)))
    expect(fillBarTime(at(iso(et(2031, 3, 10, 10, 34, -4))), bars5, '5')).toBe(toChartTime(et(2031, 3, 10, 10, 30, -4)))
    // the bar's first second and its last second
    expect(fillBarTime(at(iso(et(2031, 3, 10, 15, 55, -4))), bars5, '5')).toBe(toChartTime(et(2031, 3, 10, 15, 55, -4)))
    expect(fillBarTime(at(iso(et(2031, 3, 10, 15, 59, -4) + 59)), bars5, '5')).toBe(toChartTime(et(2031, 3, 10, 15, 55, -4)))
  })

  it('intraday: outside the loaded bars, in the overnight gap, or a date-only fill is skipped', () => {
    expect(fillBarTime(at(iso(et(2031, 3, 6, 11, 0, -5))), bars5, '5')).toBe(null)    // before the first bar
    expect(fillBarTime(at(iso(et(2031, 3, 11, 11, 0, -4))), bars5, '5')).toBe(null)   // after the last bar
    expect(fillBarTime(at(iso(et(2031, 3, 7, 18, 0, -5))), bars5, '5')).toBe(null)    // Friday evening, no bar there
    expect(fillBarTime(at('2031-03-10'), bars5, '5')).toBe(null)
  })

  it('extended hours: a pre-market fill lands on its pre-market bar when they are shown, and is skipped when not', () => {
    const ext = [...day(2031, 3, 10, -4, [4, 0], [20, 0], 5)]
    const pre = at(iso(et(2031, 3, 10, 7, 17, -4)))
    expect(fillBarTime(pre, ext, '5', { extended: true })).toBe(toChartTime(et(2031, 3, 10, 7, 15, -4)))
    expect(fillBarTime(pre, mon5, '5', { extended: false })).toBe(null)
    // RTH-only 60m session grid: the 15:30 bar must not swallow a 16:20 post-market fill
    const rth60 = day(2031, 3, 10, -4, [9, 30], [16, 0], 60)
    expect(fillBarTime(at(iso(et(2031, 3, 10, 16, 20, -4))), rth60, '60', { extended: false })).toBe(null)
    expect(fillBarTime(at(iso(et(2031, 3, 10, 10, 45, -4))), rth60, '60', { extended: false })).toBe(toChartTime(et(2031, 3, 10, 10, 30, -4)))
  })

  it('a custom minute timeframe (45m) buckets by its own length', () => {
    const b45 = day(2031, 3, 10, -4, [9, 30], [16, 0], 45)
    expect(fillBarTime(at(iso(et(2031, 3, 10, 10, 59, -4))), b45, '45')).toBe(toChartTime(et(2031, 3, 10, 10, 15, -4)))
    expect(fillBarTime(at(iso(et(2031, 3, 10, 11, 0, -4))), b45, '45')).toBe(toChartTime(et(2031, 3, 10, 11, 0, -4)))
  })

  const daily = ['2031-03-06', '2031-03-07', '2031-03-10', '2031-03-11'].map((time) => ({ time }))
  it('daily: the fill\'s ET date (a late-evening ET fill stays on its ET day); a date-only entry its date', () => {
    expect(fillBarTime(at(iso(et(2031, 3, 10, 21, 30, -4))), daily, 'D')).toBe('2031-03-10')   // 01:30Z next day
    expect(fillBarTime(at(iso(et(2031, 3, 7, 7, 0, -5))), daily, 'D')).toBe('2031-03-07')      // pre-market → that day's bar
    expect(fillBarTime(at('2031-03-11'), daily, 'D')).toBe('2031-03-11')
    expect(fillBarTime(at('2031-03-08'), daily, 'D')).toBe(null)                               // a weekend: no bar
    expect(fillBarTime(at('2031-03-12'), daily, 'D')).toBe(null)                               // past the loaded range
    expect(fillBarTime(at('2031-03-05'), daily, 'D')).toBe(null)
  })

  it('weekly: Friday-labelled bars take every day of their week', () => {
    const weekly = ['2031-02-28', '2031-03-07', '2031-03-14'].map((time) => ({ time }))
    expect(fillBarTime(at('2031-03-03'), weekly, 'W')).toBe('2031-03-07')                      // Monday
    expect(fillBarTime(at(iso(et(2031, 3, 7, 15, 59, -5))), weekly, 'W')).toBe('2031-03-07')    // Friday itself
    expect(fillBarTime(at(iso(et(2031, 3, 10, 10, 0, -4))), weekly, 'W')).toBe('2031-03-14')    // the DST Monday
    expect(fillBarTime(at('2031-03-17'), weekly, 'W')).toBe(null)                              // a week not loaded
    expect(fillBarTime(at('2031-02-20'), weekly, 'W')).toBe(null)                              // its week (Fri 02-21) is not loaded
  })

  it('monthly: first-of-month bars take every day of their month', () => {
    const monthly = ['2031-01-01', '2031-02-01', '2031-03-01'].map((time) => ({ time }))
    expect(fillBarTime(at('2031-02-27'), monthly, 'M')).toBe('2031-02-01')
    expect(fillBarTime(at(iso(et(2031, 3, 31, 15, 0, -4))), monthly, 'M')).toBe('2031-03-01')
    expect(fillBarTime(at('2031-04-02'), monthly, 'M')).toBe(null)
    expect(fillBarTime(at('2030-12-31'), monthly, 'M')).toBe(null)
  })

  it('a bar list of the wrong kind for the timeframe draws nothing (never a guess)', () => {
    expect(fillBarTime(at('2031-03-10'), bars5, 'D')).toBe(null)
    expect(fillBarTime(at(iso(et(2031, 3, 10, 10, 0, -4))), daily, '5')).toBe(null)
    expect(fillBarTime(at('2031-03-10'), [], 'D')).toBe(null)
  })
})

describe('how a bar\'s fills read', () => {
  it('one fill: "Bought 100 @ 10.50 · <date, time ET>"; a date-only one has no time', () => {
    expect(fillTitle(fill('buy', 100, 10.5, iso(et(2031, 3, 10, 10, 31, -4))))).toMatch(/^Bought 100 @ 10\.50 · Mar 10, 2031,? 10:31\sAM$/)
    expect(fillTitle(fill('sell', 2.5, 0.4321, '2031-03-07'))).toBe('Sold 2.5 @ 0.4321 · Mar 7, 2031')
  })
  it('several: "3 fills · net +200" (buys minus sells)', () => {
    const t = iso(et(2031, 3, 10, 10, 31, -4))
    expect(barFillsTitle([fill('buy', 100, 10, t), fill('buy', 150, 10.1, t), fill('sell', 50, 10.2, t)])).toBe('3 fills · net +200')
    expect(barFillsTitle([fill('buy', 100, 10, t), fill('sell', 300, 10.2, t)])).toBe('2 fills · net -200')
    expect(barFillsTitle([fill('buy', 100, 10, t), fill('sell', 100, 10.2, t)])).toBe('2 fills · net 0')
  })
})

describe('buildMyTradeMarkers — what the markers controller is handed', () => {
  const bars = day(2031, 3, 10, -4, [9, 30], [16, 0], 5)
  const t1030 = toChartTime(et(2031, 3, 10, 10, 30, -4))
  const t1100 = toChartTime(et(2031, 3, 10, 11, 0, -4))
  const fills = [
    fill('buy', 100, 10, iso(et(2031, 3, 10, 10, 31, -4))),
    fill('buy', 150, 10.1, iso(et(2031, 3, 10, 10, 33, -4))),
    fill('sell', 50, 10.2, iso(et(2031, 3, 10, 10, 34, -4))),
    fill('sell', 200, 11, iso(et(2031, 3, 10, 11, 2, -4))),
    fill('buy', 10, 9, iso(et(2031, 3, 11, 10, 0, -4))),               // outside the loaded bars
  ]
  const opts = { upColor: '#2faf68', downColor: '#df4646' }

  it('buy = small up-arrow below, sell = small down-arrow above; one bar with both gets both; skipped fills draw nothing', () => {
    const { markers, tips } = buildMyTradeMarkers(fills, bars, '5', opts)
    expect(markers.map((m) => [m.time, m.position, m.shape])).toEqual([
      [t1030, 'belowBar', 'arrowUp'], [t1030, 'aboveBar', 'arrowDown'], [t1100, 'aboveBar', 'arrowDown'],
    ])
    for (const m of markers) {
      expect(m.id.startsWith(MY_TRADE_ID_PREFIX)).toBe(true)
      expect(m.size).toBeLessThan(1)
      expect(m.text).toBeUndefined()            // no permanent label — the words are the hover tooltip
    }
    expect(tips[markers[0].id]).toBe('3 fills · net +200')
    expect(tips[markers[1].id]).toBe('3 fills · net +200')
    expect(tips[markers[2].id]).toMatch(/^Sold 200 @ 11\.00 · Mar 10, 2031,? 11:02\sAM$/)
  })

  it('colours are the chart\'s own up / down at reduced strength — never gold', () => {
    const { markers } = buildMyTradeMarkers(fills, bars, '5', opts)
    expect(markers[0].color).toBe('rgba(47,175,104,0.6)')
    expect(markers[1].color).toBe('rgba(223,70,70,0.6)')
    expect(markers.some((m) => /dcbb5e|ut-gold/i.test(m.color))).toBe(false)
    expect(buildMyTradeMarkers(fills, bars, '5', { upColor: '#0f0', downColor: 'rgba(255,0,0,0.5)' }).markers.map((m) => m.color))
      .toEqual(['rgba(0,255,0,0.6)', 'rgba(255,0,0,0.3)', 'rgba(255,0,0,0.3)'])
  })

  it('no fills / no bars / nothing in range is the one empty constant', () => {
    expect(buildMyTradeMarkers([], bars, '5', opts)).toBe(EMPTY_MY_TRADES)
    expect(buildMyTradeMarkers(fills, [], '5', opts)).toBe(EMPTY_MY_TRADES)
    expect(buildMyTradeMarkers([fills[4]], bars, '5', opts)).toBe(EMPTY_MY_TRADES)
  })

  it('sameMyTrades keeps the old array while the drawn set is unchanged (a bars refresh re-hands nothing)', () => {
    const a = buildMyTradeMarkers(fills, bars, '5', opts)
    const b = buildMyTradeMarkers(fills, [...bars], '5', opts)
    expect(sameMyTrades(a, b)).toBe(a)
    const c = buildMyTradeMarkers(fills.slice(0, 1), bars, '5', opts)
    expect(sameMyTrades(a, c)).toBe(c)
  })

  it('withMyTradeMarkers merges into the chart\'s existing markers in time order', () => {
    const mine = buildMyTradeMarkers(fills, bars, '5', opts).markers
    const other = [{ time: t1030 - 300, shape: 'circle' }, { time: t1100 + 300, shape: 'circle' }]
    const all = withMyTradeMarkers(other, mine)
    expect(all.map((m) => m.time)).toEqual([...all.map((m) => m.time)].sort((x, y) => x - y))
    expect(all).toHaveLength(5)
    expect(withMyTradeMarkers(other, [])).toEqual(other)
  })
})

describe('mutedTone', () => {
  it('hex, short hex, rgb and rgba; anything else passes through', () => {
    expect(mutedTone('#ffffff', 0.5)).toBe('rgba(255,255,255,0.5)')
    expect(mutedTone('#abc', 1)).toBe('rgba(170,187,204,1)')
    expect(mutedTone('rgb(1, 2, 3)', 0.6)).toBe('rgba(1,2,3,0.6)')
    expect(mutedTone('var(--x)')).toBe('var(--x)')
  })
})

describe('useMyTradeFills — the Journal\'s own reads, fetched only while ON', () => {
  const wrapper = ({ children }) => (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, refreshInterval: 0 }}>{children}</SWRConfig>
  )
  afterEach(() => { vi.restoreAllMocks(); delete globalThis.fetch })

  it('OFF fetches nothing', async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
    const { result } = renderHook(() => useMyTradeFills(false, 'TSTA'), { wrapper })
    await new Promise((r) => setTimeout(r, 20))
    expect(result.current).toBe(null)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('ON reads GET /api/j2/trades?symbol= and /api/j2/positions (read-only) and keeps this symbol\'s fills', async () => {
    globalThis.fetch = vi.fn((url) => Promise.resolve({
      ok: true,
      json: () => Promise.resolve(String(url).startsWith('/api/j2/trades')
        ? { trades: [{ symbol: 'TSTA', side: 'Long', shares: 5, entryPrice: 3, entryDate: '2031-03-10', exitPrice: 4, exitDate: '2031-03-11' }, { symbol: 'TSTAB', side: 'Long', shares: 9, entryPrice: 3, entryDate: '2031-03-10', exitPrice: 4, exitDate: '2031-03-11' }] }
        : { positions: [{ symbol: 'TSTA', side: 'Long', shares: 2, entryPrice: 3.5, entryDate: '2031-03-12' }] }),
    }))
    const { result } = renderHook(() => useMyTradeFills(true, 'tsta'), { wrapper })
    await waitFor(() => expect(result.current?.length).toBe(3))
    const urls = globalThis.fetch.mock.calls.map((c) => String(c[0])).sort()
    expect(urls).toEqual([MY_TRADES_POSITIONS_KEY, myTradesUrl('TSTA')].sort())
    expect(myTradesUrl('tsta')).toBe('/api/j2/trades?symbol=TSTA')
    expect(globalThis.fetch.mock.calls.every((c) => !c[1]?.method || c[1].method === 'GET')).toBe(true)
  })

  it('a signed-out / failed read draws nothing', async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }))
    const { result } = renderHook(() => useMyTradeFills(true, 'TSTA'), { wrapper })
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
    await waitFor(() => expect(result.current).toEqual([]))
  })

  it('no symbol fetches nothing', async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
    renderHook(() => useMyTradeFills(true, ''), { wrapper })
    await new Promise((r) => setTimeout(r, 20))
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})
