// @vitest-environment jsdom
// Chart Settings → Markers → Your activity → Price alerts: which alerts draw, how, and that the lines follow the list.
// Synthetic symbols and prices only.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { SWRConfig, useSWRConfig } from 'swr'
import {
  activeAlertLevels, alertPriceLines, syncAlertPriceLines, usePriceAlertRows,
  PRICE_ALERTS_KEY, ALERT_LINE_COLOR, ALERT_LINE_TITLE,
} from './priceAlertLines'

const row = (over = {}) => ({ id: 'a1', sym: 'TSTA', target_price: 10.5, direction: 'above', is_active: 1, alert_type: 'price', ...over })

describe('activeAlertLevels — which alerts are drawn', () => {
  it('the chart symbol only, matched case-insensitively both ways', () => {
    const alerts = [row({ id: 'a1', sym: 'tsta' }), row({ id: 'a2', sym: 'TSTB', target_price: 20 }), row({ id: 'a3', sym: ' TSTA ', target_price: 11 })]
    expect(activeAlertLevels(alerts, 'TSTA')).toEqual([{ id: 'a1', price: 10.5 }, { id: 'a3', price: 11 }])
    expect(activeAlertLevels(alerts, 'tsta')).toEqual([{ id: 'a1', price: 10.5 }, { id: 'a3', price: 11 }])
    expect(activeAlertLevels(alerts, 'TSTC')).toEqual([])
  })
  it('active only: an alert that went off (inactive) or was never active is not drawn', () => {
    const alerts = [row({ id: 'a1' }), row({ id: 'a2', is_active: 0, triggered_at: '2026-01-02T15:00:00Z' }), row({ id: 'a3', is_active: false }), row({ id: 'a4', is_active: true, target_price: 12 })]
    expect(activeAlertLevels(alerts, 'TSTA').map((l) => l.id)).toEqual(['a1', 'a4'])
  })
  it('a sloped trendline alert has no single price → not drawn; line (horizontal / Fib / position) and plain alerts are', () => {
    const alerts = [row({ id: 'p' }), row({ id: 'l', alert_type: 'line', target_price: 9 }), row({ id: 't', alert_type: 'trendline', target_price: 11 }), row({ id: 'n', alert_type: undefined, target_price: 8 })]
    expect(activeAlertLevels(alerts, 'TSTA').map((l) => l.id)).toEqual(['n', 'l', 'p'])
  })
  it('unusable rows and inputs draw nothing', () => {
    expect(activeAlertLevels(null, 'TSTA')).toEqual([])
    expect(activeAlertLevels([row()], '')).toEqual([])
    expect(activeAlertLevels([row({ target_price: null }), row({ target_price: 'x' }), row({ target_price: 0 }), null], 'TSTA')).toEqual([])
    expect(activeAlertLevels([row({ target_price: '10.25' })], 'TSTA')).toEqual([{ id: 'a1', price: 10.25 }])
  })
})

describe('alertPriceLines — how they are drawn', () => {
  it('a dashed 1px line with the axis label "Alert" in the muted (non-gold) alert colour', () => {
    expect(alertPriceLines([{ id: 'a1', price: 10.5 }])).toEqual([
      { price: 10.5, color: ALERT_LINE_COLOR, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, lineVisible: true, title: 'Alert' },
    ])
    expect(ALERT_LINE_TITLE).toBe('Alert')
    expect(ALERT_LINE_COLOR.toLowerCase()).not.toMatch(/^#(d4a|c9a|e0b|f5c|ffd|ffc)/)   // not a gold
    expect(alertPriceLines([])).toEqual([])
  })
})

const fakeSeries = () => {
  const lines = new Set()
  return {
    lines,
    createPriceLine: vi.fn((o) => { const h = { o }; lines.add(h); return h }),
    removePriceLine: vi.fn((h) => { lines.delete(h) }),
    prices: () => [...lines].map((h) => h.o.price).sort((a, b) => a - b),
  }
}
const linesFor = (alerts, sym) => alertPriceLines(activeAlertLevels(alerts, sym))

describe('syncAlertPriceLines — the lines follow the list, the symbol and the series', () => {
  it('draws, then a deleted alert disappears, then an unchanged list makes no calls', () => {
    const s = fakeSeries(); const st = { series: null, handles: [], key: '' }
    syncAlertPriceLines(st, s, linesFor([row({ id: 'a1' }), row({ id: 'a2', target_price: 12 })], 'TSTA'))
    expect(s.prices()).toEqual([10.5, 12])
    syncAlertPriceLines(st, s, linesFor([row({ id: 'a2', target_price: 12 })], 'TSTA'))   // a1 deleted
    expect(s.prices()).toEqual([12])
    const calls = s.createPriceLine.mock.calls.length + s.removePriceLine.mock.calls.length
    syncAlertPriceLines(st, s, linesFor([row({ id: 'a2', target_price: 12 })], 'TSTA'))
    expect(s.createPriceLine.mock.calls.length + s.removePriceLine.mock.calls.length).toBe(calls)
  })
  it('a symbol switch clears the old symbol\'s lines; the setting OFF clears them all', () => {
    const s = fakeSeries(); const st = { series: null, handles: [], key: '' }
    const book = [row({ id: 'a1', sym: 'TSTA' }), row({ id: 'b1', sym: 'TSTB', target_price: 30 })]
    syncAlertPriceLines(st, s, linesFor(book, 'TSTA'))
    expect(s.prices()).toEqual([10.5])
    syncAlertPriceLines(st, s, linesFor(book, 'TSTB'))
    expect(s.prices()).toEqual([30])
    syncAlertPriceLines(st, s, linesFor(book, 'TSTC'))
    expect(s.prices()).toEqual([])
    syncAlertPriceLines(st, s, linesFor(book, 'TSTB'))
    syncAlertPriceLines(st, s, [])                                    // OFF
    expect(s.prices()).toEqual([])
  })
  it('an alert that goes off (turns inactive) loses its line', () => {
    const s = fakeSeries(); const st = { series: null, handles: [], key: '' }
    syncAlertPriceLines(st, s, linesFor([row()], 'TSTA'))
    expect(s.prices()).toEqual([10.5])
    syncAlertPriceLines(st, s, linesFor([row({ is_active: 0, triggered_at: '2026-01-02T15:00:00Z' })], 'TSTA'))
    expect(s.prices()).toEqual([])
  })
  it('a new candle series (chart-type swap / recreated chart) gets the lines drawn again', () => {
    const s1 = fakeSeries(); const s2 = fakeSeries(); const st = { series: null, handles: [], key: '' }
    const want = linesFor([row()], 'TSTA')
    syncAlertPriceLines(st, s1, want)
    syncAlertPriceLines(st, s2, want)
    expect(s2.prices()).toEqual([10.5])
    expect(st.series).toBe(s2)
    syncAlertPriceLines(st, null, want)                                // no series yet: nothing thrown
    expect(st.handles).toEqual([])
  })
  it('a series that throws (already removed) never breaks the chart', () => {
    const bad = { createPriceLine: () => { throw new Error('gone') }, removePriceLine: () => { throw new Error('gone') } }
    const st = { series: null, handles: [], key: '' }
    expect(() => syncAlertPriceLines(st, bad, linesFor([row()], 'TSTA'))).not.toThrow()
    expect(() => syncAlertPriceLines(st, fakeSeries(), [])).not.toThrow()
  })
})

describe('usePriceAlertRows — the existing alerts list, fetched only while ON', () => {
  const wrapper = ({ children }) => (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, refreshInterval: 0 }}>{children}</SWRConfig>
  )
  afterEach(() => { vi.restoreAllMocks(); delete globalThis.fetch })

  it('OFF fetches nothing', async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([]) }))
    const { result } = renderHook(() => usePriceAlertRows(false), { wrapper })
    await new Promise((r) => setTimeout(r, 20))
    expect(result.current).toBe(null)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('ON reads GET /api/watchlist-alerts (the key every alert write revalidates); a delete elsewhere drops the row', async () => {
    let book = [row({ id: 'a1' }), row({ id: 'a2', target_price: 12 })]
    globalThis.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(book) }))
    const { result } = renderHook(() => ({ rows: usePriceAlertRows(true), mutate: useSWRConfig().mutate }), { wrapper })
    await waitFor(() => expect(result.current.rows?.length).toBe(2))
    expect(String(globalThis.fetch.mock.calls[0][0])).toBe(PRICE_ALERTS_KEY)
    expect(globalThis.fetch.mock.calls.every((c) => !c[1] || !c[1].method || c[1].method === 'GET')).toBe(true)   // read-only
    book = [row({ id: 'a2', target_price: 12 })]
    // what every create / delete path does (useWatchlistAlerts, AlertsWidget, the chart menu)
    await act(async () => { await result.current.mutate((k) => typeof k === 'string' && k.startsWith('/api/watchlist-alerts')) })
    await waitFor(() => expect(result.current.rows?.map((a) => a.id)).toEqual(['a2']))
  })

  it('a signed-out / failed read draws nothing', async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }))
    const { result } = renderHook(() => usePriceAlertRows(true), { wrapper })
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
    await waitFor(() => expect(result.current).toEqual([]))
  })
})
