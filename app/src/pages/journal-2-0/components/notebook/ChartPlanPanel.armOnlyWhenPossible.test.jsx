// @vitest-environment jsdom
// Finish program, lane KEYS: "Arm alert at this level" is offered only where it can work.
//
// A level written as a bare price, with no anchor point on the chart, cannot carry an alert
// (the alert follows the line's own geometry). The panel offered the button on such a level
// anyway and answered the press with "This level cannot carry an alert yet": a control that
// refuses after the click. It now says why before the click, and offers no button.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { SWRConfig } from 'swr'
import ChartPlanPanel from './ChartPlanPanel'

vi.mock('lightweight-charts', () => ({
  createChart: () => ({ addSeries: () => ({}), timeScale: () => ({}), remove: () => {} }),
  createSeriesMarkers: () => ({ setMarkers: () => {} }),
  CandlestickSeries: {}, LineStyle: { Dashed: 2 }, ColorType: { Solid: 'solid' },
}))

const drawn = { id: 'd-drawn', type: 'horizontal', role: 'stop', points: [{ time: 1758000000, price: 140 }] }
const bare = { id: 'd-bare', type: 'horizontal', role: 'entry', price: 150 }
const attrs = (annotations) => ({
  widgetId: 'chart', embedId: 'emb-1', params: { symbol: 'AMD', tf: 'D', to: '2026-03-13' },
  annotations, ta: null, capturedAt: '2026-03-13T20:00:00Z',
})

const realFetch = global.fetch
beforeEach(() => {
  global.fetch = vi.fn(async (url) => ({
    ok: true, status: 200,
    json: async () => (String(url) === '/api/watchlist-alerts' ? [] : {}),
  }))
})
afterEach(() => { global.fetch = realFetch })

function mount(annotations) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ChartPlanPanel attrs={attrs(annotations)} noteId="note-1" open updateAttributes={vi.fn()} />
    </SWRConfig>,
  )
}
const row = (id) => document.querySelector(`li[data-level-id="${id}"]`)

describe('ChartPlanPanel: the alert button is offered only on a level that can carry one', () => {
  it('a drawn level (it has an anchor point) offers the button', () => {
    mount([drawn, bare])
    expect(within(row('d-drawn')).getByRole('button', { name: /^Arm alert at this level/ })).toBeTruthy()
  })

  it('a bare-price level offers no button and says why, before any click', () => {
    mount([drawn, bare])
    const r = row('d-bare')
    expect(r).toBeTruthy()
    expect(within(r).queryByRole('button', { name: /^Arm alert at this level/ })).toBeNull()
    expect(within(r).getByText(/Draw this level on the chart to set an alert/)).toBeTruthy()
  })

  it('it offers no direction picker either: there is nothing to point one at', () => {
    mount([{ ...bare, role: undefined }])
    expect(within(row('d-bare')).queryByRole('combobox', { name: /Alert direction/ })).toBeNull()
  })

  it('the refusal sentence is gone from the page: the press that produced it cannot happen', () => {
    mount([bare])
    expect(screen.queryByText(/cannot carry an alert yet/)).toBeNull()
  })
})
