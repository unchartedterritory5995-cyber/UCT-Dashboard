// @vitest-environment jsdom
// Finish program, lane KEYS round 2: opening the trade plan puts focus in it.
//
// The Plan button sits in the chart's toolbar and the panel renders below the chart. After
// pressing Plan a keyboard member was still on the button, with the rest of the toolbar, the
// chart and its three scale buttons between them and the first field of the plan (11 Tabs at
// 1280 px). The panel now takes focus when it OPENS, so the next Tab is its first control.
// A panel that is already open when the note is opened takes nothing.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import { SWRConfig } from 'swr'
import ChartPlanPanel from './ChartPlanPanel'

vi.mock('lightweight-charts', () => ({
  createChart: () => ({ addSeries: () => ({}), timeScale: () => ({}), remove: () => {} }),
  createSeriesMarkers: () => ({ setMarkers: () => {} }),
  CandlestickSeries: {}, LineStyle: { Dashed: 2 }, ColorType: { Solid: 'solid' },
}))

const attrs = {
  widgetId: 'chart', embedId: 'emb-1', params: { symbol: 'AMD', tf: 'D', to: '2026-03-13' },
  annotations: [], ta: null, capturedAt: '2026-03-13T20:00:00Z',
}
const realFetch = global.fetch
beforeEach(() => {
  global.fetch = vi.fn(async (url) => ({
    ok: true, status: 200, json: async () => (String(url) === '/api/watchlist-alerts' ? [] : {}),
  }))
})
afterEach(() => { global.fetch = realFetch })

const ui = (open) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <button type="button">Plan</button>
    <ChartPlanPanel attrs={attrs} noteId="note-1" open={open} updateAttributes={vi.fn()} />
  </SWRConfig>
)
const panel = () => document.querySelector('[data-chart-plan-panel]')
const TABBABLE = 'a[href], button:not([disabled]), select, input, textarea'

describe('ChartPlanPanel: opening it moves focus into it', () => {
  it('closed, then opened: focus is on the panel and the next stop is its first control', () => {
    const view = render(ui(false))
    document.querySelector('button').focus()
    view.rerender(ui(true))
    const p = panel()
    expect(document.activeElement).toBe(p)
    expect(p.getAttribute('tabindex')).toBe('-1')
    expect(p.querySelector(TABBABLE)).toBeTruthy()     // NON-VACUITY: there is a control to reach
  })

  it('a panel that is open from the start takes no focus', () => {
    render(ui(true))
    expect(panel()).toBeTruthy()
    expect(document.activeElement).toBe(document.body)
  })

  it('closing and opening again takes focus again', () => {
    const view = render(ui(false))
    view.rerender(ui(true))
    view.rerender(ui(false))
    document.querySelector('button').focus()
    view.rerender(ui(true))
    expect(document.activeElement).toBe(panel())
  })
})
