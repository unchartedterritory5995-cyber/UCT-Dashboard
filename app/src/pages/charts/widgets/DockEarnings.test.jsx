/**
 * DockEarnings — the rendered table.
 *
 * The load-bearing test here is COLUMN PARITY. The previous implementation chose
 * a grid width per row, from the panel width AND from whether the row was an
 * estimate, so estimate rows emitted three cells into a five-column grid and did
 * not line up with the reported ones. Every row must now emit exactly the cells
 * the header names, whatever kind of row it is — that property, not any
 * particular pixel, is what makes this a table.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, within, waitFor, fireEvent } from '@testing-library/react'
import DockEarnings from './DockEarnings'

// ── payload builders ────────────────────────────────────────────────────────
const quarter = (fy, fq, over = {}) => ({
  fiscal_year: fy, fiscal_quarter: fq, label: `FY${fy} Q${fq}`,
  reported: true, period_end: '2026-05-28', report_date: '2026-06-25',
  eps_actual: 2.5, eps_estimate: 2.3, revenue_actual: 1.0e10, revenue_estimate: 9.5e9,
  eps_yoy_pct: 40, rev_yoy_pct: 30, eps_surprise_pct: 8.7, rev_surprise_pct: 5.3,
  net_margin_pct: 24.4, eps_basis: 'consensus_comparable', ...over,
})
const estimate = (fy, fq, over = {}) => ({
  fiscal_year: fy, fiscal_quarter: fq, label: `FY${fy} Q${fq}`,
  reported: false, eps_estimate: 3.1, revenue_estimate: 1.2e10,
  eps_yoy_pct: 24, rev_yoy_pct: 20, report_date: '2026-11-19', ...over,
})

const payload = (over = {}) => ({
  ticker: 'MU',
  quarters: [quarter(2026, 3), quarter(2026, 2), quarter(2026, 1)],
  estimates: [estimate(2027, 1), estimate(2026, 4)],
  annual: { reported: [], estimates: [] },
  summary: { next_report_date: '2026-11-19', next_eps_estimate: 3.1 },
  meta: {
    actuals_source: 'fmp/finnhub', estimates_available: true,
    eps_basis: 'consensus-comparable (provider adjusted)',
    fiscal_calendar: { known: true, quarter_basis: '13-week blocks', fiscal_year_end: '2025-08-28', anchors_observed: 3 },
    fiscal_method: 'Fiscal periods are placed on the company\'s own filed fiscal-year-end dates.',
    yoy_method: 'same fiscal quarter one year earlier',
    surprise_method: '(actual − estimate) ÷ |estimate|',
  },
  ...over,
})

function mockApi({ intel = payload(), filings = { filings: [] } } = {}) {
  global.fetch = vi.fn((url) => {
    const body = String(url).includes('/api/filings/') ? filings : intel
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
  })
}

const rows = () => document.querySelectorAll('[class*="etRow"]')
const headCells = () => document.querySelector('[class*="etHead"]')?.children ?? []
// A header cell ships BOTH a full and a short form (CSS picks one by container
// width; jsdom applies no CSS, so textContent would read "EPS YoYYoY").
const headLabels = () => [...headCells()].map(c => {
  const full = c.querySelector('[class*="etHeadFull"]')
  return (full || c).textContent
})

afterEach(() => { delete global.fetch; vi.restoreAllMocks() })


describe('column parity — the property that makes this a table', () => {
  beforeEach(() => mockApi())

  it('every row emits exactly the cells the header names', async () => {
    render(<DockEarnings sym="MU" />)
    await screen.findByText('FY2026 Q3')
    const expected = headCells().length
    expect(expected).toBe(5)
    expect(rows().length).toBeGreaterThan(0)
    for (const row of rows()) {
      expect(row.children).toHaveLength(expected)
    }
  })

  it('estimate rows and reported rows have identical cell counts', async () => {
    // The exact regression: forward rows used to drop three children into a
    // five-column grid, so their values sat under the wrong headings.
    render(<DockEarnings sym="MU" />)
    await screen.findByText('FY2026 Q3')
    const est = [...rows()].filter(r => within(r).queryByText('EST'))
    const rep = [...rows()].filter(r => !within(r).queryByText('EST'))
    expect(est.length).toBeGreaterThan(0)
    expect(rep.length).toBeGreaterThan(0)
    expect(est[0].children.length).toBe(rep[0].children.length)
  })

  it('names the five columns', async () => {
    render(<DockEarnings sym="MU" />)
    await screen.findByText('FY2026 Q3')
    expect(headLabels()).toEqual(['Period', 'EPS', 'EPS YoY', 'Sales', 'Sales YoY'])
  })

  it('ships a short header form for the narrow breakpoint', async () => {
    render(<DockEarnings sym="MU" />)
    await screen.findByText('FY2026 Q3')
    const short = [...headCells()].map(c => c.querySelector('[class*="etHeadShort"]')?.textContent)
    expect(short).toEqual([undefined, undefined, 'YoY', undefined, 'YoY'])
  })
})


describe('the timeline', () => {
  beforeEach(() => mockApi())

  it('runs estimates then reported, newest first', async () => {
    render(<DockEarnings sym="MU" />)
    await screen.findByText('FY2026 Q3')
    const labels = [...rows()].map(r => r.querySelector('[class*="etPeriodFull"]').textContent)
    expect(labels).toEqual(['FY2027 Q1', 'FY2026 Q4', 'FY2026 Q3', 'FY2026 Q2', 'FY2026 Q1'])
  })

  it('heads each group', async () => {
    render(<DockEarnings sym="MU" />)
    await screen.findByText('Estimates')
    expect(screen.getByText('Reported')).toBeInTheDocument()
  })

  it('marks estimates without dimming their values', async () => {
    render(<DockEarnings sym="MU" />)
    await screen.findByText('FY2026 Q4')
    const est = [...rows()].find(r => within(r).queryByText('EST'))
    // The consensus figures are present and readable, not hidden behind a lock.
    expect(within(est).getByText('$3.10')).toBeInTheDocument()
    expect(within(est).getByText('$12.00B')).toBeInTheDocument()
  })

  it('renders both period forms so the container query can pick one', async () => {
    render(<DockEarnings sym="MU" />)
    await screen.findByText('FY2026 Q3')
    const row = rows()[0]
    expect(row.querySelector('[class*="etPeriodFull"]').textContent).toBe('FY2027 Q1')
    expect(row.querySelector('[class*="etPeriodShort"]').textContent).toBe('FY27 Q1')
  })
})


describe('the value language', () => {
  it('golds triple-digit growth and reds a decline', async () => {
    mockApi({ intel: payload({
      estimates: [],
      quarters: [quarter(2026, 3, { eps_yoy_pct: 346, rev_yoy_pct: -9 })],
    }) })
    render(<DockEarnings sym="MU" />)
    const gold = await screen.findByText('+346%')
    expect(gold.className).toMatch(/etGold/)
    expect(screen.getByText('−9%').className).toMatch(/neg/)
  })

  it('renders a swing through zero as words, never a percentage', async () => {
    mockApi({ intel: payload({
      estimates: [],
      quarters: [
        quarter(2026, 3, { eps_yoy_pct: null, eps_yoy_note: 'turned_profitable' }),
        quarter(2026, 2, { eps_yoy_pct: null, eps_yoy_note: 'turned_negative' }),
      ],
    }) })
    render(<DockEarnings sym="MU" />)
    expect(await screen.findByText('Profitable')).toBeInTheDocument()
    expect(screen.getByText('To loss')).toBeInTheDocument()
  })

  it('shows an em dash where there is no comparison, not a zero', async () => {
    mockApi({ intel: payload({
      estimates: [],
      quarters: [quarter(2026, 3, { eps_yoy_pct: null, rev_yoy_pct: null })],
    }) })
    render(<DockEarnings sym="MU" />)
    await screen.findByText('FY2026 Q3')
    expect(within(rows()[0]).getAllByText('—')).toHaveLength(2)
  })
})


describe('next report lives on the Estimates head, not a strip', () => {
  it('annotates the Estimates section with the date', async () => {
    mockApi({ intel: payload({ summary: { next_report_date: '2026-09-30' } }) })
    render(<DockEarnings sym="MU" />)
    await screen.findByText('Estimates')
    // NB: `etSectionTitle` itself matches [class*="etSection"], so climb to the
    // head via the parent element rather than closest().
    const head = screen.getByText('Estimates').parentElement
    expect(head.className).toMatch(/etSection_/)
    expect(within(head).getByText('Next report')).toBeInTheDocument()
    expect(within(head).getByText('Sep 30')).toBeInTheDocument()
  })

  it('no longer renders a strip above the table', async () => {
    mockApi({ intel: payload({ summary: { next_report_date: '2026-09-30' } }) })
    render(<DockEarnings sym="MU" />)
    await screen.findByText('FY2026 Q3')
    expect(document.querySelector('[class*="etStrip"]')).toBeNull()
  })

  it('does not repeat the EPS and Sales estimates above the table', async () => {
    // They are already the next row down; saying them twice was the duplication
    // this pass removed.
    mockApi({ intel: payload({
      estimates: [estimate(2026, 4, { eps_estimate: 31.28, revenue_estimate: 5.078e10 })],
      summary: { next_report_date: '2026-09-30', next_eps_estimate: 31.28,
        next_revenue_estimate: 5.078e10 },
    }) })
    render(<DockEarnings sym="MU" />)
    await screen.findByText('FY2026 Q3')
    expect(screen.getAllByText('$31.28')).toHaveLength(1)
    expect(screen.getAllByText('$50.78B')).toHaveLength(1)
  })
})


describe('Earnings Quality', () => {
  const quality = (over = {}) => payload({ summary: {
    eps_accel_quarters: 3, eps_trend: 'accelerating',
    rev_accel_quarters: 2, rev_trend: 'accelerating',
    eps_beats: 4, eps_beats_of: 5, rev_beats: 4, rev_beats_of: 5,
    double_beat_streak: 3, net_margin_pct: 68.1, net_margin_delta_pp: 12.4,
    ...over,
  } })

  it('renders the retrospective block below the table', async () => {
    mockApi({ intel: quality() })
    render(<DockEarnings sym="MU" />)
    expect(await screen.findByText('Earnings quality')).toBeInTheDocument()
    expect(screen.getByText('EPS acceleration')).toBeInTheDocument()
    expect(screen.getByText('Sales acceleration')).toBeInTheDocument()
    // EPS and Sales beat rates both read '4 of 5' here.
    expect(screen.getAllByText('4 of 5')).toHaveLength(2)
    expect(screen.getByText('EPS beat rate')).toBeInTheDocument()
    expect(screen.getByText('Sales beat rate')).toBeInTheDocument()
    expect(screen.getByText('68.1%')).toBeInTheDocument()
    expect(screen.getByText('+12.4 pts')).toBeInTheDocument()
  })

  it('draws a margin sparkline only when there is a series', async () => {
    mockApi({ intel: quality({ net_margin_series: [20, 24, 28, 33, 41, 68] }) })
    render(<DockEarnings sym="MU" />)
    await screen.findByText('Earnings quality')
    expect(document.querySelector('[class*="etQSpark"] svg')).toBeTruthy()
  })

  it('is absent in Annual mode — every fact in it is a QUARTERLY signal', async () => {
    mockApi({ intel: quality() })
    render(<DockEarnings sym="MU" />)
    await screen.findByText('Earnings quality')
    fireEvent.click(screen.getByText('Annual'))
    await waitFor(() => expect(screen.queryByText('Earnings quality')).toBeNull())
  })

  it('is absent entirely when consensus and margin are unavailable', async () => {
    mockApi({ intel: payload({ summary: {} }) })
    render(<DockEarnings sym="MU" />)
    await screen.findByText('FY2026 Q3')
    expect(screen.queryByText('Earnings quality')).toBeNull()
  })
})


describe('deeper history is a toggle', () => {
  const twelve = () => payload({
    estimates: [],
    quarters: Array.from({ length: 12 }, (_, i) => quarter(2026 - Math.floor(i / 4), 4 - (i % 4))),
  })

  it('opens to twelve and closes back to eight', async () => {
    mockApi({ intel: twelve() })
    render(<DockEarnings sym="MU" />)
    await screen.findByText('Reported')
    expect(rows()).toHaveLength(8)
    fireEvent.click(screen.getByText('Show 4 more'))
    await waitFor(() => expect(rows()).toHaveLength(12))
    fireEvent.click(screen.getByText('Show less'))
    await waitFor(() => expect(rows()).toHaveLength(8))
  })

  it('closes a quarter that was opened among the extra four', async () => {
    mockApi({ intel: twelve() })
    render(<DockEarnings sym="MU" />)
    await screen.findByText('Reported')
    fireEvent.click(screen.getByText('Show 4 more'))
    await waitFor(() => expect(rows()).toHaveLength(12))
    fireEvent.click(rows()[10])                     // an extra-four row
    await waitFor(() => expect(document.querySelector('[class*="etDetail"]')).toBeTruthy())
    fireEvent.click(screen.getByText('Show less'))
    // It must not stay open invisibly.
    await waitFor(() => expect(document.querySelector('[class*="etDetail"]')).toBeNull())
  })

  it('leaves a quarter open when it survives the collapse', async () => {
    mockApi({ intel: twelve() })
    render(<DockEarnings sym="MU" />)
    await screen.findByText('Reported')
    fireEvent.click(screen.getByText('Show 4 more'))
    await waitFor(() => expect(rows()).toHaveLength(12))
    fireEvent.click(rows()[1])                      // inside the first eight
    await waitFor(() => expect(document.querySelector('[class*="etDetail"]')).toBeTruthy())
    fireEvent.click(screen.getByText('Show less'))
    await waitFor(() => expect(rows()).toHaveLength(8))
    expect(document.querySelector('[class*="etDetail"]')).toBeTruthy()
  })

  it('offers no control when there is nothing deeper', async () => {
    mockApi()
    render(<DockEarnings sym="MU" />)
    await screen.findByText('FY2026 Q3')
    expect(screen.queryByText(/Show \d+ more/)).toBeNull()
    expect(screen.queryByText('Show less')).toBeNull()
  })

  it('resets to eight when the mode changes', async () => {
    mockApi({ intel: twelve() })
    render(<DockEarnings sym="MU" />)
    await screen.findByText('Reported')
    fireEvent.click(screen.getByText('Show 4 more'))
    await waitFor(() => expect(rows()).toHaveLength(12))
    fireEvent.click(screen.getByText('Annual'))
    fireEvent.click(screen.getByText('Quarterly'))
    await waitFor(() => expect(rows()).toHaveLength(8))
  })
})


describe('degradation', () => {
  it('says so when a security has no earnings, without implying a failure', async () => {
    mockApi({ intel: payload({
      quarters: [], estimates: [], annual: { reported: [], estimates: [] },
      summary: {}, meta: { fiscal_calendar: { known: false } },
    }) })
    render(<DockEarnings sym="SPY" />)
    expect(await screen.findByText(/does not publish company earnings/)).toBeInTheDocument()
  })

  it('runs in actuals-only mode without inventing a surprise', async () => {
    mockApi({ intel: payload({
      estimates: [],
      quarters: [quarter(2026, 3, {
        eps_estimate: null, revenue_estimate: null,
        eps_surprise_pct: null, rev_surprise_pct: null,
        eps_surprise_note: 'no_comparable_estimate', eps_basis: 'gaap_diluted',
      })],
      meta: { ...payload().meta, estimates_available: false },
    }) })
    render(<DockEarnings sym="MU" />)
    fireEvent.click((await screen.findByText('FY2026 Q3')).closest('[class*="etRow"]'))
    await waitFor(() => expect(screen.getAllByText('Actual').length).toBeGreaterThan(0))
    expect(screen.queryByText(/Beat by/)).toBeNull()
    expect(screen.getByText(/No consensus on a comparable basis/)).toBeInTheDocument()
  })

  it('reports the fiscal calendar it used', async () => {
    mockApi()
    render(<DockEarnings sym="MU" />)
    await screen.findByText('FY2026 Q3')
    fireEvent.click(screen.getByText('Data & methodology'))
    await waitFor(() => expect(
      screen.getByText(/Year ends 2025-08-28 .* placed on 3 filed year-end dates/)).toBeInTheDocument())
  })

  it('renders nothing but a notice without a symbol', () => {
    mockApi()
    render(<DockEarnings sym={null} />)
    expect(screen.getByText('No symbol.')).toBeInTheDocument()
  })
})
