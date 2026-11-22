/**
 * DockFinancials — the source line and the three kinds of "nothing to show".
 *
 * The statements behind this panel come from one of two sources, and
 * `meta.source` says which. The panel must print that one, and it must not tell
 * a member "no statement is available" when the truth is "the read failed".
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import DockFinancials from './DockFinancials'

const row = (period, revenue) => ({ period, reported_period: period, values: { revenue, net_income: revenue / 5 } })
const empty = () => ({ annual: [], quarterly: [], ttm: null, ttm_series: [] })
const statements = (meta = {}, over = {}) => ({
  ticker: 'AAPL',
  income: { annual: [row('2025-09-30', 400e9), row('2024-09-30', 390e9)],
    quarterly: [row('2026-06-30', 90e9)], ttm: null, ttm_series: [] },
  balance: empty(),
  cashflow: empty(),
  meta: { source: 'FMP', retrieved_at: 1790000000, fiscal_year_end: '09-30', annual_periods: 2, quarterly_periods: 1, ...meta },
  ...over,
})

// `bodies` is answered in order; the last one repeats.
function mount(...bodies) {
  let n = 0
  const statementCalls = []
  global.fetch = vi.fn((url) => {
    const u = String(url)
    let body = { filings: [] }
    if (u.includes('/api/fundamentals-statements/')) {
      statementCalls.push(u)
      body = bodies[Math.min(n, bodies.length - 1)]
      n += 1
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
  })
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <DockFinancials sym="AAPL" />
    </SWRConfig>,
  )
  return statementCalls
}

afterEach(() => { delete global.fetch; vi.restoreAllMocks() })

// "Revenue" is both a section heading and a row label, so the row is found by its metric key.
const revenueRow = () => waitFor(() => {
  const el = document.querySelector('[data-metric="revenue"]')
  expect(el).toBeTruthy()
  return el
})

describe('the source line names the source that answered', () => {
  const sourceLine = async () => {
    fireEvent.click(await screen.findByRole('button', { name: 'Data & sources' }))
    return document.body.textContent
  }

  it('FMP', async () => {
    mount(statements())
    const text = await sourceLine()
    expect(text).toContain('FMP · as-reported figures')
    expect(text).not.toContain('Yahoo')
  })

  it('Yahoo Finance, when that is what the payload says', async () => {
    mount(statements({ source: 'Yahoo Finance' }))
    expect(await sourceLine()).toContain('Yahoo Finance · as-reported figures')
  })

  it('never a source by default', async () => {
    mount(statements({ source: undefined }))
    const text = await sourceLine()
    expect(text).toContain('Source not recorded · as-reported figures')
    expect(text).not.toContain('Yahoo')
    expect(text).not.toContain('FMP')
  })
})

describe('a failed read is not "no statements"', () => {
  const failed = { error: 'statements temporarily unavailable', state: 'unavailable', ticker: 'AAPL', meta: { source: 'FMP' } }

  it('says it could not be loaded, and asks again on request', async () => {
    const calls = mount(failed, statements())
    const box = await screen.findByTestId('fin-unavailable')
    expect(box.textContent).toContain('could not be loaded just now')
    expect(document.body.textContent).not.toContain('statement is available')
    expect(calls).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await revenueRow()
    expect(calls).toHaveLength(2)
    expect(screen.queryByTestId('fin-unavailable')).toBeNull()
  })

  it('a half that failed says so on the view that needs it, and only there', async () => {
    const half = statements({ partial: ['quarterly'] })
    half.income.quarterly = []
    mount(half)
    await revenueRow()                                       // Annual is whole
    expect(screen.queryByTestId('fin-unavailable')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Quarterly' }))
    await waitFor(() => expect(screen.getByTestId('fin-unavailable')).toBeTruthy())
    expect(document.body.textContent).not.toContain('statement is available')
  })

  it('a company with no statements keeps its own words', async () => {
    mount({ error: 'no statements available', ticker: 'AAPL', security_type: 'equity', meta: { source: 'Yahoo Finance' } })
    await screen.findByText(/No income statement is available for AAPL/)
    expect(screen.queryByTestId('fin-unavailable')).toBeNull()
  })

  it('a fund keeps its own words', async () => {
    mount({ error: 'no statements available', ticker: 'AAPL', security_type: 'etf', meta: { source: 'Yahoo Finance' } })
    await screen.findByText(/is an ETF, so it does not publish company/)
    expect(screen.queryByTestId('fin-unavailable')).toBeNull()
  })
})
