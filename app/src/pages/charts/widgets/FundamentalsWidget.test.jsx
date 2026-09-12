import { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import { WorkspaceContext } from '../WorkspaceContext'
import FundamentalsWidget from './FundamentalsWidget'

const mockData = vi.fn()
vi.mock('../../../hooks/useEarningsTable', () => ({
  default: () => ({ data: mockData() }),
}))
vi.mock('../../../components/fundamentals/AnalystPanel', () => ({
  default: ({ sym }) => <div data-testid="analyst-panel">{sym}</div>,
}))
vi.mock('../../../components/fundamentals/OwnershipPanel', () => ({
  default: ({ sym }) => <div data-testid="ownership-panel">{sym}</div>,
}))

// Stateful wrapper that threads opts through onOptsChange, mirroring how the
// workspace persists per-widget opts — so a toggle click actually updates view.
function Wrap({ color = 'A', sym = 'AAPL', initialOpts = {}, onOpts }) {
  const [opts, setOpts] = useState(initialOpts)
  const groupSyms = { A: null, B: null, C: null, D: null, [color]: sym }
  const handle = (next) => { setOpts(next); onOpts?.(next) }
  return (
    <WorkspaceContext.Provider value={{ groupSyms, setGroupSym: () => {} }}>
      <FundamentalsWidget color={color} opts={opts} onOptsChange={handle} />
    </WorkspaceContext.Provider>
  )
}

const FULL_DATA = {
  ticker: 'AAPL',
  annual: [
    { year: 2024, eps: 2.37, eps_chg_pct: 45, sales: 6.0e9, sales_chg_pct: 12, estimate: false },
    { year: 2026, eps: 3.15, eps_chg_pct: 14, sales: 7.8e9, sales_chg_pct: 15, estimate: true, eps_revision: 'up' },
  ],
  quarterly: [
    { label: '2025 Q2', eps_actual: 0.64, eps_estimate: 0.57, eps_surprise_pct: 12, rev_actual: 1.63e9, rev_estimate: 1.43e9, rev_surprise_pct: 14, reported: true },
    { label: '2026 Q2', report_date: '2026-08-05', eps_estimate: 0.58, rev_estimate: 1.5e9, eps_est_chg_pct: -9.4, rev_est_chg_pct: 8.0, reported: false },
  ],
}

test('defaults to the quarterly view (annual hidden until toggled)', () => {
  mockData.mockReturnValue(FULL_DATA)
  render(<Wrap />)
  expect(screen.getByText('2025 Q2')).toBeInTheDocument()
  expect(screen.queryByText('2024')).not.toBeInTheDocument()
})

test('forward estimate quarter shows YoY growth % on EPS and Sales estimates', () => {
  mockData.mockReturnValue(FULL_DATA)
  render(<Wrap />)
  // forward block (2026 Q2) carries YoY growth alongside the estimates
  expect(screen.getByText('-9.4%')).toBeInTheDocument()
  expect(screen.getByText('+8%')).toBeInTheDocument()
})

test('a forward quarter with no report_date falls back to its period_end date', () => {
  // A later forward quarter carries no scheduled report date yet — the card must
  // still show a truthful date (the fiscal period end) rather than a blank line.
  mockData.mockReturnValue({
    ticker: 'AAPL',
    quarterly: [
      { label: '2025 Q2', eps_actual: 0.64, eps_estimate: 0.57, eps_surprise_pct: 12, rev_actual: 1.63e9, rev_estimate: 1.43e9, rev_surprise_pct: 14, reported: true },
      { label: '2026 Q3', report_date: null, period_end: '2026-09-30', eps_estimate: 0.60, rev_estimate: 1.1e9, reported: false },
    ],
  })
  render(<Wrap />)
  expect(screen.getByText('2026-09-30')).toBeInTheDocument()
})

test('Analyst tab renders the AnalystPanel for the ticker', () => {
  mockData.mockReturnValue(FULL_DATA)
  render(<Wrap initialOpts={{ view: 'analyst' }} />)
  expect(screen.getByTestId('analyst-panel')).toHaveTextContent('AAPL')
})

test('Analyst tab renders even when earnings data is empty', () => {
  mockData.mockReturnValue(null)
  render(<Wrap initialOpts={{ view: 'analyst' }} />)
  expect(screen.getByTestId('analyst-panel')).toHaveTextContent('AAPL')
})

test('Ownership tab renders the OwnershipPanel (even with no earnings data)', () => {
  mockData.mockReturnValue(null)
  render(<Wrap initialOpts={{ view: 'ownership' }} />)
  expect(screen.getByTestId('ownership-panel')).toHaveTextContent('AAPL')
})

test('annual rows render newest-first (forward estimate at top)', () => {
  mockData.mockReturnValue(FULL_DATA)
  render(<Wrap initialOpts={{ view: 'annual' }} />)
  const yearCells = screen.getAllByRole('cell').filter(c => /^20\d{2}( e)?$/.test(c.textContent))
  expect(yearCells[0]).toHaveTextContent('2026 e')   // forward estimate leads
  expect(yearCells[yearCells.length - 1]).toHaveTextContent('2024')  // oldest at bottom
})

test('toggling to Annual swaps the visible section and persists the choice', () => {
  mockData.mockReturnValue(FULL_DATA)
  const onOpts = vi.fn()
  render(<Wrap onOpts={onOpts} />)
  fireEvent.click(screen.getByRole('tab', { name: /annual/i }))
  expect(screen.getByText('2024')).toBeInTheDocument()
  expect(screen.queryByText('2025 Q2')).not.toBeInTheDocument()  // quarterly now hidden
  expect(onOpts).toHaveBeenCalledWith(expect.objectContaining({ view: 'annual' }))
})

test('restores the persisted view from opts (annual on first render)', () => {
  mockData.mockReturnValue(FULL_DATA)
  render(<Wrap initialOpts={{ view: 'annual' }} />)
  expect(screen.getByText('2024')).toBeInTheDocument()
  expect(screen.queryByText('2025 Q2')).not.toBeInTheDocument()
})

test('falls back to annual when no quarterly data exists', () => {
  mockData.mockReturnValue({ ...FULL_DATA, quarterly: [] })
  render(<Wrap />)
  // quarterly is the default but has no rows → effective view is annual
  expect(screen.getByText('2024')).toBeInTheDocument()
  expect(screen.getByRole('tab', { name: /quarterly/i })).toBeDisabled()
})

test('shows pick-a-ticker prompt when no symbol', () => {
  mockData.mockReturnValue(null)
  const groupSyms = { A: null, B: null, C: null, D: null }
  render(
    <WorkspaceContext.Provider value={{ groupSyms, setGroupSym: () => {} }}>
      <FundamentalsWidget color="A" opts={{}} />
    </WorkspaceContext.Provider>,
  )
  expect(screen.getByText(/pick a ticker/i)).toBeInTheDocument()
})

test('shows empty state when data has no rows', () => {
  mockData.mockReturnValue({ ticker: 'ZZ', annual: [], quarterly: [] })
  render(<Wrap sym="ZZ" />)
  expect(screen.getByText(/no fundamentals/i)).toBeInTheDocument()
})

// FIX C (8/21 UI stress sweep, zero_a11y_name:_gearBtn_edx06_211): the
// icon-only settings gear had only a `title`, which the sweep's a11y check
// (aria-label OR textContent) never reads — an icon-only button with no
// aria-label and no text is invisible to it. Pin the fix.
test('the icon-only settings gear button has an accessible name', () => {
  mockData.mockReturnValue(FULL_DATA)
  render(<Wrap />)
  expect(screen.getByRole('button', { name: 'Fundamentals settings' })).toBeInTheDocument()
})

// ── stale reported strip ──────────────────────────────────────────────────────
// The widget used to present an old quarter as the latest with nothing said.
// Measured on prod 2026-09-11: MMC's newest reported quarter was 2025 Q4 because
// FMP's earnings feed stops at 2026-01-29 and neither fallback covers it — the
// member saw a table that looked current. ~2.3% of the universe is in this state,
// S&P 500 names included. Assert RENDERED TEXT: a notice nobody can read is the
// same defect as no notice at all.
const STALE_DATA = {
  ticker: 'MMC',
  annual: [{ year: 2025, eps: 8.1, sales: 2.4e10, estimate: false }],
  quarterly: [
    { label: '2025 Q4', eps_actual: 1.87, rev_actual: 6.6e9, reported: true },
    { label: '2026 Q2', report_date: '2026-10-15', eps_estimate: 1.97, reported: false },
  ],
  reported_through: '2025 Q4',
  stale_quarters: 2,
}

test('a stale reported strip says so, and names the last quarter it actually has', () => {
  mockData.mockReturnValue(STALE_DATA)
  render(<Wrap sym="MMC" initialOpts={{ view: 'quarterly' }} />)
  const notice = screen.getByTestId('fundamentals-stale-notice')
  expect(notice).toBeTruthy()
  expect(notice.textContent).toMatch(/2025 Q4/)
})

test('a current strip shows no staleness notice', () => {
  mockData.mockReturnValue({ ...FULL_DATA, reported_through: '2026 Q2', stale_quarters: 0 })
  render(<Wrap sym="AAPL" initialOpts={{ view: 'quarterly' }} />)
  expect(screen.queryByTestId('fundamentals-stale-notice')).toBeNull()
})

test('an older payload without the staleness fields shows no notice', () => {
  // A snapshot persisted before this shipped has neither key; it must render
  // exactly as before rather than defaulting to an alarming notice.
  mockData.mockReturnValue(FULL_DATA)
  render(<Wrap sym="AAPL" initialOpts={{ view: 'quarterly' }} />)
  expect(screen.queryByTestId('fundamentals-stale-notice')).toBeNull()
})
