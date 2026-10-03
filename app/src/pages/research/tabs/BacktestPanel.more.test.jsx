// FT-011 -- the backtester's earnings anchor and further structures, asserted on rendered text.
// Payloads are RECORDED from the backend (backtestEarningsFixture.json, see its _readme); no network.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import BacktestPanel from './BacktestPanel'
import FX from './backtestEarningsFixture.json'

let catalogStatus
let postBody
beforeEach(() => {
  catalogStatus = 200
  postBody = null
  global.fetch = vi.fn((url, init) => {
    const u = String(url)
    const json = (status, body) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) })
    if (u.endsWith('/backtest-catalog')) return json(catalogStatus, catalogStatus === 200 ? FX.catalog : { detail: 'Not Found' })
    if (u.endsWith('/backtest') && init?.method === 'POST') {
      postBody = JSON.parse(init.body)
      return json(202, { job: 'j1', state: 'queued' })
    }
    if (u.includes('/backtest/j1')) return json(200, { job: 'j1', state: 'done', result: FX.earnings })
    return json(404, {})
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const wrap = (ui) => render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>)

describe('BacktestPanel with FT-011 switched on', () => {
  it('offers every catalog structure and the earnings anchor', async () => {
    wrap(<BacktestPanel sym="SPY" />)
    const anchor = await screen.findByLabelText('Entry anchor')
    expect(anchor).toBeTruthy()
    const opts = [...screen.getByLabelText('Backtest strategy').querySelectorAll('option')].map((o) => o.textContent)
    expect(opts).toContain('Iron condor (credit)')
    expect(opts).toContain('Long straddle')
    expect(opts.length).toBe(FX.catalog.strategies.length)
  })

  it('an earnings run sends the anchor, no entry days, no exit rule, and shows the AMC/BMO rule', async () => {
    wrap(<BacktestPanel sym="SPY" />)
    fireEvent.change(await screen.findByLabelText('Backtest strategy'), { target: { value: 'long_straddle' } })
    fireEvent.change(screen.getByLabelText('Entry anchor'), { target: { value: 'earnings' } })
    expect(screen.queryByLabelText('Entry days before expiry')).toBeNull()
    expect(screen.queryByLabelText('Take profit')).toBeNull()
    fireEvent.click(screen.getByTestId('backtest-simulate'))
    await screen.findByTestId('backtest-result')
    expect(postBody).toEqual({ strategy: 'long_straddle', anchor: 'earnings', offset: 0, width: 0 })
    expect(screen.getByTestId('backtest-anchor').textContent).toMatch(/after the close \(AMC\)/)
    expect(screen.getByTestId('backtest-anchor').textContent).toMatch(/before the open \(BMO\)/)
    const rows = screen.getByTestId('backtest-trades').querySelectorAll('tbody tr')
    expect(rows.length).toBe(FX.earnings.trades.length)
    expect(rows[0].textContent).toContain('2025-10-22 AMC')
    expect(rows[0].textContent).toContain('closed after the print')
    expect(screen.getByTestId('backtest-excluded').textContent).toContain('print 2026-01-28: the report time')
    expect(screen.getByTestId('backtest-small-sample').textContent).toMatch(/too small/)
  })

  it('switched off (404) it is exactly the first slice: four structures, no anchor', async () => {
    catalogStatus = 404
    wrap(<BacktestPanel sym="SPY" />)
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(screen.queryByLabelText('Entry anchor')).toBeNull()
    expect(screen.getByLabelText('Backtest strategy').querySelectorAll('option').length).toBe(4)
  })
})
