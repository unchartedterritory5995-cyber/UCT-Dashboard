// ALRT — rendered text and real behaviour against a fake network. The alert routes are served by a
// fake `fetch`; only the live-price store is stood in for (it polls every 2 s).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { SWRConfig } from 'swr'

const live = vi.hoisted(() => ({ prices: {}, asked: [] }))
vi.mock('../../../hooks/useLivePrices', () => ({
  default: (tickers) => { live.asked.push(tickers); return { prices: live.prices, isLoading: false, error: null } },
}))

import AlertsPanel, { ALERTS_LIST_URL, alertRows, distancePct } from './AlertsPanel'

const ALERTS = [
  { id: 'a1', sym: 'NVDA', target_price: 950, direction: 'above', is_active: 1, triggered_at: null, alert_type: 'price' },
  { id: 'a2', sym: 'AMD', target_price: 140, direction: 'below', is_active: 1, triggered_at: null, alert_type: 'price' },
  { id: 'a3', sym: 'NVDA', target_price: 800, direction: 'below', is_active: 0, triggered_at: '2026-10-07T14:31:00+00:00', alert_type: 'line' },
]

const realFetch = globalThis.fetch
let calls = []
function serve(routes) {
  calls = []
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    calls.push([String(url), init.method || 'GET'])
    const hit = routes[`${init.method || 'GET'} ${url}`]
    if (hit === undefined) return new Response('{}', { status: 404 })
    if (typeof hit === 'number') return new Response('{"detail":"x"}', { status: hit })
    if (typeof hit === 'function') return hit()
    return new Response(JSON.stringify(hit), { status: 200, headers: { 'Content-Type': 'application/json' } })
  })
}

function renderPanel(props = {}) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <AlertsPanel {...props} />
    </SWRConfig>,
  )
}

beforeEach(() => {
  live.prices = { NVDA: { price: 900 }, AMD: { price: 150 } }
  live.asked = []
})
afterEach(() => { cleanup(); globalThis.fetch = realFetch })

describe('ALRT — the list', () => {
  it('lists every alert, active first, with the price now, the distance to go and a Delete per row', async () => {
    serve({ [`GET ${ALERTS_LIST_URL}`]: ALERTS })
    const onRows = vi.fn()
    renderPanel({ onRows })
    await screen.findByTestId('terminal-alerts-table')
    const nvda = screen.getByTestId('terminal-alerts-row-a1')
    expect(nvda.textContent).toContain('NVDA')
    expect(nvda.textContent).toContain('Above $950.00')
    expect(nvda.textContent).toContain('$900.00')
    expect(nvda.textContent).toContain('+5.6%')
    expect(nvda.textContent).toContain('Active')
    expect(screen.getByTestId('terminal-alerts-row-a2').textContent).toContain('Below $140.00')
    const fired = screen.getByTestId('terminal-alerts-row-a3')
    expect(fired.textContent).toMatch(/Triggered 10\/7\/2026, 10:31:00 AM ET/)   // ET, labelled
    expect(fired.textContent).toContain('(chart line)')
    expect(screen.getByLabelText('Delete the NVDA alert above $950.00')).toBeTruthy()
    expect(onRows).toHaveBeenLastCalledWith(['$AMD', '$NVDA', '$NVDA'])
    expect(live.asked.at(-1)).toEqual(['AMD', 'NVDA'])   // ONE pooled ask, never a per-row read
    expect(screen.getByText(/2 active alerts/)).toBeTruthy()
  })

  it('NVDA ALRT shows only NVDA, and a symbol click loads it into the linked panels', async () => {
    serve({ [`GET ${ALERTS_LIST_URL}`]: ALERTS })
    const onRun = vi.fn()
    renderPanel({ sym: 'NVDA', onRun })
    await screen.findByTestId('terminal-alerts-table')
    expect(screen.queryByTestId('terminal-alerts-row-a2')).toBeNull()
    fireEvent.click(screen.getAllByLabelText('Load NVDA into the linked panels')[0])
    expect(onRun).toHaveBeenCalledWith('$NVDA', { keepFunction: true })
  })

  it('Delete calls the alert route, and the list re-reads', async () => {
    let list = ALERTS
    serve({
      [`GET ${ALERTS_LIST_URL}`]: () => new Response(JSON.stringify(list), { status: 200 }),
      'DELETE /api/watchlist-alerts/a2': () => { list = ALERTS.filter((a) => a.id !== 'a2'); return new Response('{"ok":true}', { status: 200 }) },
    })
    renderPanel()
    await screen.findByTestId('terminal-alerts-table')
    await act(async () => { fireEvent.click(screen.getByTestId('terminal-alerts-delete-a2')) })
    expect(calls).toContainEqual(['/api/watchlist-alerts/a2', 'DELETE'])
    expect(screen.queryByTestId('terminal-alerts-row-a2')).toBeNull()
  })

  it('a Delete that fails says so in plain English and keeps the row', async () => {
    serve({ [`GET ${ALERTS_LIST_URL}`]: ALERTS, 'DELETE /api/watchlist-alerts/a2': 500 })
    renderPanel()
    await screen.findByTestId('terminal-alerts-table')
    await act(async () => { fireEvent.click(screen.getByTestId('terminal-alerts-delete-a2')) })
    expect(screen.getByTestId('terminal-alerts-delete-error').textContent)
      .toBe('The AMD alert could not be deleted just now. It is still set; try again.')
    expect(screen.getByTestId('terminal-alerts-row-a2')).toBeTruthy()
  })
})

describe('ALRT — empty and failed', () => {
  it('no alerts says how to set one, in the member\'s ticker', async () => {
    serve({ [`GET ${ALERTS_LIST_URL}`]: [] })
    renderPanel({ sym: 'TSLA' })
    const empty = await screen.findByTestId('terminal-alerts-empty')
    expect(empty.textContent).toContain('No price alerts on TSLA.')
    expect(empty.textContent).toContain('TSLA ALRT 950')
  })

  it('a failed read is an error with Retry, never "no alerts"', async () => {
    let n = 0
    serve({ [`GET ${ALERTS_LIST_URL}`]: () => (++n === 1 ? new Response('{}', { status: 500 }) : new Response(JSON.stringify(ALERTS), { status: 200 })) })
    renderPanel()
    const err = await screen.findByTestId('terminal-alerts-error')
    expect(err.textContent).toContain('Your alerts could not be read just now.')
    expect(err.textContent).toContain('not the same as having no alerts')
    expect(screen.queryByTestId('terminal-alerts-empty')).toBeNull()
    await act(async () => { fireEvent.click(screen.getByText('Retry')) })
    expect(await screen.findByTestId('terminal-alerts-table')).toBeTruthy()
  })

  it('a paywall reads as a plan, not an outage', async () => {
    serve({ [`GET ${ALERTS_LIST_URL}`]: 402 })
    renderPanel()
    const err = await screen.findByTestId('terminal-alerts-error')
    expect(err.textContent).toContain('Price alerts need a paid plan.')
    expect(screen.queryByText('Retry')).toBeNull()
  })
})

describe('ALRT — the pure parts', () => {
  it('alertRows filters by ticker and orders active first; distancePct is signed and null-safe', () => {
    expect(alertRows(ALERTS, 'nvda').map((r) => r.id)).toEqual(['a1', 'a3'])
    expect(alertRows(null)).toEqual([])
    expect(distancePct(950, 900)).toBeCloseTo(5.555, 2)
    expect(distancePct(140, 150)).toBeCloseTo(-6.667, 2)
    expect(distancePct(950, null)).toBeNull()
    expect(distancePct(950, 0)).toBeNull()
  })
})
