// TERM-045 (dark, EDGAR_OWNERSHIP_ENABLED): the insider section when the server
// sourced it from SEC EDGAR Form 4. Asserts RENDERED TEXT, never state: every
// state must say what it is, and an unknown must never read as "none".
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { PENDING_REASK_MS, PENDING_REASK_MAX } from '../depth/depthFetch'

const mutate = vi.fn()
let current = null

vi.mock('../hooks/useOwnership', () => ({ default: () => ({ data: current, isLoading: false, mutate }) }))

import OwnershipTab from './OwnershipTab'

const bare = {
  sym: 'AAPL',
  entity: { status: 'resolved', entityId: 'em_aapl' },
  institutional: { pct_held: null, holders: [] },
  short: {},
  share_counts: {},
  thirteen_f: null,
}

const row = {
  name: 'LEVINSON ARTHUR D', title: 'Director', type: 'sell', shares: 149527, price: 284.57,
  amount: 42550903.39, date: '2026-05-06', filing_date: '2026-05-08', form: '4',
  accession: '0001140361-26-020298',
  url: 'https://www.sec.gov/Archives/edgar/data/320193/000114036126020298/0001140361-26-020298-index.htm',
}

function src(extra) {
  return { vendor: 'sec_edgar', label: 'SEC EDGAR Form 4', window_days: 180, filings_listed: 3,
    filings_read: 3, filings_unread: [], truncated_at_cap: false, index_short: false, ...extra }
}

describe('OwnershipTab — SEC EDGAR Form 4 insider section', () => {
  beforeEach(() => { mutate.mockClear() })

  it('renders EDGAR rows with a link to each Form 4 and a source line', () => {
    current = { ...bare, insider: [row], insider_source: src({ state: 'ok' }) }
    render(<OwnershipTab sym="AAPL" />)
    expect(screen.getByText('LEVINSON ARTHUR D · Director')).toBeInTheDocument()
    const link = screen.getByRole('link', { name: 'Form 4' })
    expect(link).toHaveAttribute('href', row.url)
    expect(screen.getByText('Source: SEC EDGAR Form 4 · open-market buys and sells filed in the last 180 days'))
      .toBeInTheDocument()
  })

  // tq-panels: pending was manual-only ("Check again"). It now re-asks by itself
  // (usePendingReask), and offers the manual check only once the re-asks are spent.
  it('says it is still reading, asks again by itself, and never says there is nothing', () => {
    vi.useFakeTimers()
    try {
      current = { ...bare, insider: null, insider_source: src({ state: 'pending' }) }
      render(<OwnershipTab sym="AAPL" />)
      expect(screen.getByText('Reading SEC EDGAR Form 4 filings for AAPL… this fills in by itself.')).toBeInTheDocument()
      expect(screen.queryByText(/No open-market insider buys or sells/)).toBeNull()
      expect(screen.queryByText('Ownership data is unavailable for this ticker.')).toBeNull()
      expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull()
      act(() => { vi.advanceTimersByTime(PENDING_REASK_MS) })
      expect(mutate).toHaveBeenCalledTimes(1)
    } finally { vi.useRealTimers() }
  })

  it('once the re-asks are spent it says so and offers a manual check', async () => {
    vi.useFakeTimers()
    try {
      current = { ...bare, insider: null, insider_source: src({ state: 'pending' }) }
      render(<OwnershipTab sym="AAPL" />)
      for (let i = 0; i <= PENDING_REASK_MAX; i += 1) {
        await act(async () => { vi.advanceTimersByTime(PENDING_REASK_MS) })
      }
      expect(screen.getByText('SEC EDGAR Form 4 filings for AAPL are still being read.')).toBeInTheDocument()
      mutate.mockClear()
      fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
      expect(mutate).toHaveBeenCalledTimes(1)
    } finally { vi.useRealTimers() }
  })

  it('a buy or sell reads as a capitalised word', () => {
    current = { ...bare, insider: [row, { ...row, type: 'buy', accession: 'x2' }], insider_source: src({ state: 'ok' }) }
    render(<OwnershipTab sym="AAPL" />)
    expect(screen.getByText('Sell')).toBeInTheDocument()
    expect(screen.getByText('Buy')).toBeInTheDocument()
    expect(screen.queryByText('sell')).toBeNull()
  })

  // tq-panels: one leg failing (Yahoo / insider) is named, not left as dashes.
  it('a partial failure names the leg that could not be read', () => {
    current = { ...bare, insider: [], legs_failed: ['institutional holders and short interest (Yahoo Finance)'] }
    render(<OwnershipTab sym="AAPL" />)
    expect(screen.getByTestId('ownership-partial').textContent).toMatch(
      /^Part of AAPL's ownership could not be read right now: institutional holders and short interest \(Yahoo Finance\)\. The rest is what answered\./)
  })

  it('names an unmatched filer and an unreachable SEC as unknowns', () => {
    current = { ...bare, insider: null, insider_source: src({ state: 'not_found' }) }
    const { unmount } = render(<OwnershipTab sym="AAPL" />)
    expect(screen.getByText('No SEC filer could be matched to AAPL, so insider activity is unknown.'))
      .toBeInTheDocument()
    unmount()
    current = { ...bare, insider: null, insider_source: src({ state: 'unavailable' }) }
    render(<OwnershipTab sym="AAPL" />)
    expect(screen.getByText('SEC EDGAR could not be read just now, so insider activity is unknown.'))
      .toBeInTheDocument()
  })

  it('says "none were filed" only for a complete read with no rows', () => {
    current = { ...bare, insider: [], insider_source: src({ state: 'ok' }) }
    render(<OwnershipTab sym="AAPL" />)
    expect(screen.getByText('No open-market insider buys or sells were filed on Form 4 in the last 180 days.'))
      .toBeInTheDocument()
  })

  it('names every filing it could not read', () => {
    current = {
      ...bare, insider: [row],
      insider_source: src({ state: 'partial', filings_read: 1,
        filings_unread: [{ accession: '0001140361-26-037020', reason: 'sec_404' },
          { accession: '0001140361-26-036226', reason: 'time_budget' }] }),
    }
    render(<OwnershipTab sym="AAPL" />)
    expect(screen.getByTestId('edgar-unread')).toHaveTextContent(
      '2 of 3 filings could not be read: 0001140361-26-037020, 0001140361-26-036226')
  })

  it('without insider_source the prior section renders unchanged', () => {
    current = { ...bare, insider: [{ name: 'Tim Cook', title: 'CEO', type: 'sell', shares: 50000, amount: 1.3e7,
      date: '2026-05-01' }] }
    render(<OwnershipTab sym="AAPL" />)
    expect(screen.getByText('Tim Cook · CEO')).toBeInTheDocument()
    expect(screen.queryByTestId('edgar-insider')).toBeNull()
    expect(screen.queryByText(/SEC EDGAR/)).toBeNull()
  })
})
