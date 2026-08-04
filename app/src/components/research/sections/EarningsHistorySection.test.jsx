// app/src/components/research/sections/EarningsHistorySection.test.jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'

import EarningsHistorySection from './EarningsHistorySection'
import { countGoldHighlights } from '../../research-kit/testing/restraint'

// jsdom has no canvas: mock the React wrapper, NOT echarts/core, so
// echartsCore.js's real echarts.use([...]) registration stays in the path.
let capturedOption = null
vi.mock('echarts-for-react/lib/core', () => ({
  default: (props) => { capturedOption = props.option; return <div data-testid="echart" /> },
}))

const beatHistory = [
  { period: '2026-06-30', actual: 0.91, estimate: 0.88, beat: true, surprise: 3.4 },
  { period: '2026-03-31', actual: 0.80, estimate: 0.82, beat: false, surprise: -2.4 },
  { period: '2025-12-31', actual: 0.75, estimate: 0.70, beat: true, surprise: 7.1 },
  { period: '2025-09-30', actual: 0.66, estimate: 0.66, beat: true, surprise: 0 },
]
const histStats = { avg_abs_move: 6.4, up_count: 2, total: 4, last_n: [8.2, -4.1, 5.5, -1.0] }
const row = { sym: 'NVDA', eps_estimate: 0.94, reported_eps: null,
              beat_history: beatHistory, hist_stats: histStats }

const renderSection = (props = {}) => render(
  <EarningsHistorySection sym="NVDA" row={row} reportDate="2026-08-06" timing="amc"
                          lifecycle="PRE" stepping={false}
                          expectedMove={{ live: { pct: 6.8 }, history: [], history_since: null, grade: null }}
                          {...props} />,
)

describe('EarningsHistorySection', () => {
  it('renders the EPS story and the price story on the same quarter axis', () => {
    renderSection()
    expect(screen.getByTestId('echart')).toBeTruthy()          // LollipopChart
    // NOTE (P2 T9, step 2 per the brief): ReactionBars' actual shipped root
    // testid is `rk-reaction` (stamped on its <svg>), not `rk-reaction-bars` —
    // the kit is frozen, so the test is corrected to the shipped name.
    expect(screen.getByTestId('rk-reaction')).toBeTruthy()     // ReactionBars (SVG)
    const axis = capturedOption.xAxis?.data ?? capturedOption.xAxis?.[0]?.data
    expect(axis).toEqual(['Q3 25', 'Q4 25', 'Q1 26', 'Q2 26', 'Q3 26'])
  })

  it('hands tonight’s implied to the reaction bars as the gold bracket', () => {
    const { container } = renderSection()
    expect(container.querySelector('[data-rk-gold]')).toBeTruthy()
    expect(countGoldHighlights(container)).toBe(1)   // exactly one, per canvas budget
  })

  it('omits the bracket when there is no live implied', () => {
    const { container } = renderSection({ expectedMove: { live: null, history: [] } })
    expect(countGoldHighlights(container)).toBe(0)
    expect(screen.getByTestId('rk-reaction')).toBeTruthy()
  })

  it('captions the reaction stats with their denominator', () => {
    renderSection()
    const caps = screen.getByTestId('history-stats')
    expect(caps.textContent).toMatch(/AVG MOVE/i)
    expect(caps.textContent).toMatch(/6\.4|4\.7/)      // avg |move| over the sample
    expect(caps.textContent).toMatch(/CLOSED UP/i)
    expect(caps.textContent).toMatch(/2\s*\/\s*4/)
    expect(caps.textContent).toMatch(/BEST/i)
    expect(caps.textContent).toMatch(/WORST/i)
  })

  it('renders the compact quarterly table oldest-first with the reaction column', () => {
    renderSection()
    const table = screen.getByTestId('history-table')
    const heads = within(table).getAllByRole('columnheader').map(h => h.textContent.trim())
    expect(heads).toEqual(['QUARTER', 'ACT / EST', 'SURPRISE', 'REV', 'NEXT-DAY'])
    const first = within(table).getAllByRole('row')[1]
    expect(within(first).getAllByRole('cell')[0].textContent).toBe('Q3 25')
  })

  it('renders an em dash rather than a zero for a missing reaction', () => {
    renderSection({ row: { ...row, hist_stats: { last_n: [8.2] } } })
    const table = screen.getByTestId('history-table')
    const cells = within(table).getAllByRole('row').slice(1)
      .map(r => within(r).getAllByRole('cell')[4].textContent.trim())
    expect(cells[0]).toBe('—')
    expect(cells.some(c => c === '0.0%')).toBe(false)
  })

  it('states the basis of this composition', () => {
    renderSection()
    expect(screen.getByTestId('history-basis').textContent)
      .toMatch(/4 reported quarters/)
  })

  it('shows an EmptyState — never a blank canvas — with no history', () => {
    renderSection({ row: { sym: 'NEWCO' }, reportDate: null })
    expect(screen.getByText(/no reported quarters/i)).toBeTruthy()
    expect(screen.queryByTestId('history-table')).toBeNull()
  })

  // `Number(null) === 0` has bitten this branch eight times — every numeric
  // column must be proven in BOTH directions: a missing value never renders
  // as a phantom zero, and a genuine zero never collapses to an em dash.
  it('renders a genuine zero EPS estimate, surprise, and reaction as real numbers — never as an em dash', () => {
    const zeroRow = {
      sym: 'ZERO',
      beat_history: [
        { period: '2026-06-30', actual: 0.05, estimate: 0, beat: true, surprise: 0 },
      ],
      hist_stats: { last_n: [0] },
    }
    renderSection({ row: zeroRow, reportDate: null })
    const table = screen.getByTestId('history-table')
    const dataRow = within(table).getAllByRole('row')[1]
    const cells = within(dataRow).getAllByRole('cell').map(c => c.textContent.trim())
    expect(cells[1]).toBe('$0.05 / $0.00')   // estimate is a genuine 0, not "—"
    expect(cells[2]).toBe('0.0%')            // surprise is a genuine 0, not "—"
    expect(cells[4]).toBe('0.0%')            // reaction is a genuine 0, not "—"
  })

  it('renders an em dash — never a phantom zero — when EPS estimate or surprise is genuinely missing', () => {
    const missingRow = {
      sym: 'MISSING',
      beat_history: [
        { period: '2026-06-30', actual: 0.05, estimate: null, beat: null, surprise: null },
      ],
      hist_stats: {},
    }
    renderSection({ row: missingRow, reportDate: null })
    const table = screen.getByTestId('history-table')
    const dataRow = within(table).getAllByRole('row')[1]
    const cells = within(dataRow).getAllByRole('cell').map(c => c.textContent.trim())
    expect(cells[1]).toBe('$0.05 / —')       // estimate missing -> em dash, not $0.00
    expect(cells[2]).toBe('—')               // surprise missing -> em dash, not 0.0%
  })

  it('renders a real zero "closed up" count rather than blanking the whole caption', () => {
    // Both quarters closed DOWN: a genuine 0-for-2 record, not "no data".
    const allDownRow = {
      sym: 'DOWN',
      beat_history: [
        { period: '2026-06-30', actual: 0.10, estimate: 0.10, beat: false, surprise: 0 },
        { period: '2026-03-31', actual: 0.08, estimate: 0.10, beat: false, surprise: -20 },
      ],
      hist_stats: { last_n: [-3.0, -1.5] },
    }
    renderSection({ row: allDownRow, reportDate: null })
    const caps = screen.getByTestId('history-stats')
    expect(caps.textContent).toMatch(/CLOSED UP/i)
    expect(caps.textContent).toMatch(/0\s*\/\s*2/)
  })
})
