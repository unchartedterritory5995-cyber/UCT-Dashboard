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

  // ── P2 T9 review round 1 — Important findings ────────────────────────────

  // F-2: the headline requirement ("same quarter axis") previously had no
  // gate — passing ReactionBars `reported` (a filtered subset) or a reversed
  // copy of `quarters` both survived at exit 0, because the only axis
  // assertion read the LOLLIPOP side. This reads the reaction strip's own
  // rendered quarter labels and requires them to equal the lollipop's
  // xAxis.data, same order — the two charts' `quarters` input must be
  // identical, not just similarly-shaped. (This is also the gate that would
  // have caught the Critical `last_n` mis-pairing bug, had it reordered the
  // row set rather than the reaction VALUES within a fixed row set.)
  it('draws the reaction strip on the identical quarter axis as the lollipop chart', () => {
    renderSection()
    const axis = capturedOption.xAxis?.data ?? capturedOption.xAxis?.[0]?.data
    const reactionSvg = screen.getByTestId('rk-reaction')
    // Element-tag query, not a CSS-module class — `<text>` is unhashed. The
    // divergence-star marker is ALSO a `<text>`, so it's excluded by its own
    // data-testid (rk-reaction-star) rather than by a class-shape guess.
    const labels = Array.from(reactionSvg.querySelectorAll('text'))
      .filter((t) => t.getAttribute('data-testid') !== 'rk-reaction-star')
      .map((t) => t.textContent)
    expect(labels).toEqual(axis)
  })

  // F-3: recomputing "Closed up" from `reactionStats(quarters)` instead of
  // `row.hist_stats.up_count/total` (the brief's original draft) was
  // previously UNTESTED — every earlier fixture happened to have the two
  // denominators equal, so swapping back to the raw provider fields would
  // silently survive. `last_n` (FMP/AV, <=8) and `beat_history` (Finnhub,
  // <=4) are independent caps (earningsHistoryModel.js DECISION 1) — this
  // fixture constructs the DOMINANT real-world mismatch (measured live at
  // 11 of 12 symbols) and requires the caption to match what the chart/table
  // actually show (4), not the provider's raw sample size (8).
  it('captions "closed up" against what is actually paired and visible, not the raw provider denominator', () => {
    const wideProviderRow = {
      sym: 'WIDE',
      beat_history: [
        { period: '2026-06-30', actual: 1.0, estimate: 0.9, beat: true, surprise: 11.1 },
        { period: '2026-03-31', actual: 0.8, estimate: 0.9, beat: false, surprise: -11.1 },
        { period: '2025-12-31', actual: 0.7, estimate: 0.6, beat: true, surprise: 16.7 },
        { period: '2025-09-30', actual: 0.6, estimate: 0.6, beat: true, surprise: 0 },
      ],
      // 8 next-day moves on record (FMP/AV cap) but only 4 reported quarters
      // (Finnhub beat_history cap) — only the first 4 moves ever pair.
      hist_stats: { up_count: 2, total: 8, last_n: [5, -5, 5, -5, 5, -5, 5, -5] },
    }
    renderSection({ row: wideProviderRow, reportDate: null })
    const caps = screen.getByTestId('history-stats')
    expect(caps.textContent).toMatch(/2\s*\/\s*4/)
    expect(caps.textContent).not.toMatch(/2\s*\/\s*8/)
  })

  // F-5: three of the four caption numerals (Avg move, Best, Worst) had no
  // zero-direction gate — gating any of them on VALUE truthiness instead of
  // presence would silently blank a genuine 0.0% reading. Two fixtures:
  // all-flat moves (avgAbs itself lands on exactly 0) and a mixed pair that
  // puts a real zero at BEST, then WORST, independently.
  it('renders a real zero average move rather than blanking it', () => {
    const flatRow = {
      sym: 'FLAT0',
      beat_history: [
        { period: '2026-06-30', actual: 1.0, estimate: 1.0, beat: false, surprise: 0 },
        { period: '2026-03-31', actual: 0.9, estimate: 0.9, beat: false, surprise: 0 },
      ],
      hist_stats: { last_n: [0, 0] },
    }
    renderSection({ row: flatRow, reportDate: null })
    expect(screen.getByTestId('history-stats').textContent).toMatch(/±0\.0%/)
  })

  it('renders a real zero BEST reaction rather than blanking it', () => {
    const row0Best = {
      sym: 'ZBEST',
      beat_history: [
        { period: '2026-06-30', actual: 1.0, estimate: 1.0, beat: false, surprise: 0 },
        { period: '2026-03-31', actual: 0.9, estimate: 1.0, beat: false, surprise: -10 },
      ],
      hist_stats: { last_n: [0, -2.0] },   // newest (Q2 26) flat, prior quarter down 2%
    }
    renderSection({ row: row0Best, reportDate: null })
    const caps = screen.getByTestId('history-stats')
    expect(caps.textContent).toMatch(/BEST/i)
    expect(caps.textContent).toMatch(/0\.0%/)
    expect(caps.textContent).toMatch(/-2\.0%/)
  })

  it('renders a real zero WORST reaction rather than blanking it', () => {
    const row0Worst = {
      sym: 'ZWORST',
      beat_history: [
        { period: '2026-06-30', actual: 1.0, estimate: 0.9, beat: true, surprise: 11.1 },
        { period: '2026-03-31', actual: 0.9, estimate: 1.0, beat: false, surprise: -10 },
      ],
      hist_stats: { last_n: [2.0, 0] },   // newest (Q2 26) up 2%, prior quarter flat
    }
    renderSection({ row: row0Worst, reportDate: null })
    const caps = screen.getByTestId('history-stats')
    expect(caps.textContent).toMatch(/WORST/i)
    expect(caps.textContent).toMatch(/\+2\.0%/)
    expect(caps.textContent).toMatch(/0\.0%/)
  })

  // F-6: `eps()`'s negative-sign handling had no fixture with a loss-making
  // quarter — dropping the sign would silently render a loss as a profit.
  it('renders a negative EPS with its sign — never shows a loss as a profit', () => {
    const lossRow = {
      sym: 'LOSS',
      beat_history: [
        { period: '2026-06-30', actual: -0.12, estimate: -0.20, beat: true, surprise: 40 },
      ],
      hist_stats: { last_n: [3.0] },
    }
    renderSection({ row: lossRow, reportDate: null })
    const table = screen.getByTestId('history-table')
    const dataRow = within(table).getAllByRole('row')[1]
    const cells = within(dataRow).getAllByRole('cell').map((c) => c.textContent.trim())
    expect(cells[1]).toBe('-$0.12 / -$0.20')
  })

  // F-7: the REV column's null guard was untested, and `revenue_actual` is
  // null on EVERY historical row today (Finnhub /stock/earnings carries no
  // revenue field — see the code comment on `rev()`) — the single column
  // with zero existing coverage and the dominant risk of a silently-dropped
  // guard rendering five rows of confident fake $0 revenue.
  it('renders an em dash for revenue on every history row — never a phantom $0', () => {
    renderSection()
    const table = screen.getByTestId('history-table')
    const revCells = within(table).getAllByRole('row').slice(1)
      .map((r) => within(r).getAllByRole('cell')[3].textContent.trim())
    expect(revCells.length).toBeGreaterThan(0)
    expect(revCells.every((c) => c === '—')).toBe(true)
    expect(revCells.some((c) => c === '$0M')).toBe(false)
  })

  // Minor: the table needs a programmatic name — the adjacent EyebrowLabel
  // ("By quarter") is visually beside it but not associated via aria-*.
  it('gives the quarterly table a programmatic accessible name', () => {
    renderSection()
    const table = screen.getByTestId('history-table')
    expect(table.getAttribute('aria-label') || table.querySelector('caption')).toBeTruthy()
  })
})

describe('pending vs genuinely-empty history', () => {
  // A row with no enrichment at all — exactly what the modal commits when a
  // fast click beats the enrichment batch.
  const bare = { sym: 'NVDA' }

  it('says LOADING while the enrichment batch is still in flight', () => {
    render(<EarningsHistorySection row={bare} reportDate="2026-08-27" enrichReady={false} />)
    expect(screen.getByText(/Loading earnings history/i)).toBeTruthy()
    expect(screen.queryByText(/No reported quarters yet/i)).toBeNull()
  })

  it('says NO HISTORY once the batch has landed and still has nothing', () => {
    render(<EarningsHistorySection row={bare} reportDate="2026-08-27" enrichReady />)
    expect(screen.getByText(/No reported quarters yet/i)).toBeTruthy()
    expect(screen.queryByText(/Loading earnings history/i)).toBeNull()
  })

  it('CONTROL: enrichReady never suppresses history that actually exists', () => {
    // Whatever the batch flag says, real quarters must render. This is what
    // stops the fix from degrading into "show a spinner whenever unsure".
    const withHistory = {
      sym: 'NVDA',
      beat_history: [
        { period: '2025-08-27', epsActual: 0.68, epsEstimate: 0.64, surprisePercent: 6.2 },
        { period: '2025-11-19', epsActual: 0.81, epsEstimate: 0.75, surprisePercent: 8.0 },
      ],
    }
    for (const ready of [true, false]) {
      const { unmount } = render(
        <EarningsHistorySection row={withHistory} reportDate="2026-08-27" enrichReady={ready} />,
      )
      expect(screen.getByTestId('history-table')).toBeTruthy()
      expect(screen.queryByText(/Loading earnings history/i)).toBeNull()
      expect(screen.queryByText(/No reported quarters yet/i)).toBeNull()
      unmount()
    }
  })

  it('defaults to the definitive empty state when no flag is passed', () => {
    // Other mount sites (MyStocksHub, direct research routes) do not thread
    // the flag; they must keep today's behavior, not inherit a spinner.
    render(<EarningsHistorySection row={bare} reportDate="2026-08-27" />)
    expect(screen.getByText(/No reported quarters yet/i)).toBeTruthy()
  })
})

describe('EarningsHistorySection — an unanswered provider must not become a claim', () => {
  // Live defect 2026-08-06: JAZZ ($17B, modal header "$5.71 vs $6.30 est") was
  // told it had "No reported quarters yet" while Finnhub returned four real
  // quarters on a direct call seconds later. The enrichment fan-out had shed
  // that ticker's history call for rate budget, and the UI stated the gap as a
  // fact about the company.
  const emptyRow = { sym: 'JAZZ', eps_estimate: 6.3, reported_eps: 5.71,
                     beat_history: null, hist_stats: null }

  it('says the history is UNAVAILABLE, not that the company never reported', () => {
    renderSection({ row: { ...emptyRow, history_unresolved: true }, enrichReady: true })
    expect(screen.getByText(/history unavailable/i)).toBeTruthy()
    expect(screen.queryByText(/no reported quarters yet/i)).toBeNull()
  })

  it('still says "no reported quarters" when the provider genuinely answered empty', () => {
    // The signal must stay meaningful: a real pre-IPO/never-reported name has
    // to keep its honest empty state, or this fix just trades one lie for another.
    renderSection({ row: { ...emptyRow, history_unresolved: false }, enrichReady: true })
    expect(screen.getByText(/no reported quarters yet/i)).toBeTruthy()
    expect(screen.queryByText(/history unavailable/i)).toBeNull()
  })

  it('prefers the loading state while the batch is still in flight', () => {
    // enrichReady=false must win: before the batch lands we know nothing at
    // all, and "unavailable" would be as premature as the old claim was.
    renderSection({ row: { ...emptyRow, history_unresolved: true }, enrichReady: false })
    expect(screen.getByText(/loading earnings history/i)).toBeTruthy()
    expect(screen.queryByText(/history unavailable/i)).toBeNull()
  })

  it('does not hijack a row that actually HAS quarters', () => {
    // A stale/odd flag must never blank out real data the user can see.
    renderSection({ row: { ...row, history_unresolved: true }, enrichReady: true })
    expect(screen.queryByText(/history unavailable/i)).toBeNull()
    expect(screen.getByTestId('echart')).toBeTruthy()
  })
})
