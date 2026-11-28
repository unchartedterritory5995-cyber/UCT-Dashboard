// The EPS estimate revisions card, licensed-first pass 2 (2026-11-28).
//
// The server answers the card's own read (`?revisions=1`) from UCT's daily snapshots of FMP's
// consensus when they reach back 30 days (`sources.revisions` = SNAPSHOT_REVISIONS_SOURCE), and
// from Yahoo Finance otherwise, labelled as the fallback, with the snapshot history's state beside it
// (api/routers/research.py; tests/test_licensed_fallbacks_pass2.py pins the server side).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { SWRConfig } from 'swr'
import axe from 'axe-core'

vi.mock('../../research-kit', () => ({
  SeriesChart: () => <div data-testid="chart" />,
  EmptyState: ({ title }) => <div data-testid="empty-state">{title}</div>,
}))

import { EstimateRevisions, SNAPSHOT_REVISIONS_SOURCE } from './ConsensusEstimates'

const URL = '/api/research/estimates/NVDA?revisions=1'
const SNAPSHOTS = {
  sym: 'NVDA', sources: { revisions: SNAPSHOT_REVISIONS_SOURCE },
  history: { state: 'ok', covers_from: '2026-10-05', last_snapshot: '2026-11-26' },
  revisions: [
    { period: 'Q4 FY2027', period_end: '2026-10-31', current: 1.2, ago30: 1.05, ago90: null, up30: null, down30: null },
    { period: 'Q1 FY2028', period_end: '2027-01-31', current: 1.4, ago30: 1.3, ago90: null, up30: null, down30: null },
  ],
}
const YAHOO = (history) => ({
  sym: 'NVDA', sources: { revisions: 'Yahoo Finance' }, ...(history ? { history } : {}),
  revisions: [{ period: 'Current Qtr', current: 1.0, ago30: 0.95, ago90: 0.9, up30: 12, down30: 1 }],
})

let answer
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url) => (url.startsWith(URL)
    ? { ok: true, status: 200, json: async () => answer }
    : { ok: false, status: 404, json: async () => ({}) })))
})
afterEach(() => { vi.unstubAllGlobals() })

const mount = () => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
    <main><EstimateRevisions sym="NVDA" rc="USD" /></main>
  </SWRConfig>,
)

describe('EPS estimate revisions — our FMP snapshots first, Yahoo as the fallback', () => {
  it('snapshot rows say FMP, carry no up/down columns, and say the 90-day column is still building', async () => {
    answer = SNAPSHOTS
    mount()
    const card = await screen.findByTestId('ee-revisions')
    expect(card).toHaveAttribute('data-source', 'fmp-snapshots')
    const src = within(card).getByTestId('depth-source')
    expect(src).toHaveAttribute('data-vendor', 'FMP')
    expect(src).toHaveAttribute('data-fallback', 'false')
    expect(src).toHaveTextContent('since 5 Oct 2026')
    expect(within(card).queryByText('Up (30d)')).toBeNull()
    expect(within(card).queryByText('Down (30d)')).toBeNull()
    expect(within(card).getByText('Fiscal quarter')).toBeInTheDocument()
    expect(within(card).getByText('Q4 FY2027')).toBeInTheDocument()
    expect(within(card).getByTestId('ee-revisions-building')).toHaveTextContent('90 days')
    // a missing 90-day point is a dash, never 0
    expect(within(card).getAllByText('—').length).toBeGreaterThanOrEqual(2)
    expect(within(card).queryByText('$0.00')).toBeNull()
  })

  it('Yahoo rows are labelled the fallback and keep their up/down counts', async () => {
    answer = YAHOO(null)
    mount()
    const card = await screen.findByTestId('ee-revisions')
    expect(card).toHaveAttribute('data-source', 'yfinance')
    const src = within(card).getByTestId('depth-source')
    expect(src).toHaveAttribute('data-vendor', 'Yahoo Finance')
    expect(src).toHaveAttribute('data-fallback', 'true')
    expect(within(card).getByText('Up (30d)')).toBeInTheDocument()
    expect(within(card).getByText('12')).toBeInTheDocument()
    expect(within(card).queryByTestId('ee-revisions-building')).toBeNull()
  })

  it('a history that has started but is under 30 days says so beside the Yahoo rows', async () => {
    answer = YAHOO({ state: 'building', covers_from: '2026-11-20', tracked: true })
    mount()
    const card = await screen.findByTestId('ee-revisions')
    expect(within(card).getByTestId('ee-revisions-building'))
      .toHaveTextContent("UCT has recorded FMP's consensus for this stock since 20 Nov 2026")
  })

  it('a stock the snapshot list has no room for is said, not promised', async () => {
    answer = YAHOO({ state: 'building', covers_from: null, tracked: false })
    mount()
    const card = await screen.findByTestId('ee-revisions')
    expect(within(card).getByTestId('ee-revisions-building')).toHaveTextContent('not being recorded yet')
  })

  it('axe: both variants have no table or region violations', async () => {
    for (const a of [SNAPSHOTS, YAHOO(null)]) {
      answer = a
      const { unmount } = mount()
      await screen.findByTestId('ee-revisions')
      const res = await axe.run(document.body, { resultTypes: ['violations'],
        runOnly: { type: 'rule', values: ['th-has-data-cells', 'td-headers-attr', 'scope-attr-valid', 'aria-allowed-attr', 'list', 'listitem'] } })
      expect(res.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([])
      unmount()
    }
  })
})
