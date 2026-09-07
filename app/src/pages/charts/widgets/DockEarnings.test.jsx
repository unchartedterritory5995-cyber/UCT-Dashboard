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


describe('the snapshot strip', () => {
  it('states what is coming next, in plain language', async () => {
    mockApi({ intel: payload({
      summary: { next_report_date: '2026-09-30', next_report_label: 'FY2026 Q4',
        next_eps_estimate: 31.28, next_revenue_estimate: 5.078e10 },
    }) })
    render(<DockEarnings sym="MU" />)
    expect(await screen.findByText('Sep 30')).toBeInTheDocument()
    expect(screen.getByText('$31.28')).toBeInTheDocument()
    expect(screen.getByText('$50.78B')).toBeInTheDocument()
  })

  it('does not render at all when nothing forward is known', async () => {
    mockApi({ intel: payload({ summary: {} }) })
    render(<DockEarnings sym="MU" />)
    await screen.findByText('FY2026 Q3')
    expect(document.querySelector('[class*="etStrip"]')).toBeNull()
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

  it('is absent entirely when consensus and margin are unavailable', async () => {
    mockApi({ intel: payload({ summary: {} }) })
    render(<DockEarnings sym="MU" />)
    await screen.findByText('FY2026 Q3')
    expect(screen.queryByText('Earnings quality')).toBeNull()
  })
})


describe('annual trend on the quarterly page', () => {
  const withTrend = () => payload({ annual: { estimates: [], reported: [
    { fiscal_year: 2025, label: 'FY2025', estimate: false, eps: 7.59, revenue: 3.738e10, eps_yoy_pct: 984 },
    { fiscal_year: 2024, label: 'FY2024', estimate: false, eps: 0.7, revenue: 2.511e10, eps_yoy_pct: null, eps_yoy_note: 'turned_profitable' },
    { fiscal_year: 2023, label: 'FY2023', estimate: false, eps: -5.34, revenue: 1.554e10, eps_yoy_pct: null, eps_yoy_note: 'turned_negative' },
  ] } })

  it('gives the quarterly page long-term context', async () => {
    mockApi({ intel: withTrend() })
    render(<DockEarnings sym="MU" />)
    expect(await screen.findByText('Annual trend')).toBeInTheDocument()
    expect(screen.getByText('FY2025')).toBeInTheDocument()
    expect(screen.getByText('Profitable')).toBeInTheDocument()
  })

  it('shares the table geometry — five cells, like every other row', async () => {
    mockApi({ intel: withTrend() })
    render(<DockEarnings sym="MU" />)
    await screen.findByText('Annual trend')
    for (const row of rows()) expect(row.children).toHaveLength(5)
  })

  it('is NOT repeated in Annual mode, where the table already is the annual view', async () => {
    mockApi({ intel: withTrend() })
    render(<DockEarnings sym="MU" />)
    await screen.findByText('Annual trend')
    fireEvent.click(screen.getByText('Annual'))
    await waitFor(() => expect(screen.queryByText('Annual trend')).toBeNull())
  })
})


describe('row expansion', () => {
  beforeEach(() => mockApi())

  it('opens a reported quarter into an actual-vs-estimate comparison', async () => {
    render(<DockEarnings sym="MU" />)
    const row = await screen.findByText('FY2026 Q3')
    fireEvent.click(row.closest('[class*="etRow"]'))
    // 'Actual' appears once per compared metric (EPS and Revenue).
    await waitFor(() => expect(screen.getAllByText('Actual')).toHaveLength(2))
    expect(screen.getAllByText('Estimate').length).toBeGreaterThan(0)
    expect(screen.getByText('Beat by 8.7%')).toBeInTheDocument()
    expect(screen.getByText('24.4%')).toBeInTheDocument()          // net margin
  })

  it('keeps only one row open at a time', async () => {
    render(<DockEarnings sym="MU" />)
    const q3 = await screen.findByText('FY2026 Q3')
    fireEvent.click(q3.closest('[class*="etRow"]'))
    await waitFor(() => expect(document.querySelectorAll('[class*="etDetail"]')).toHaveLength(1))
    fireEvent.click(screen.getByText('FY2026 Q2').closest('[class*="etRow"]'))
    await waitFor(() => expect(document.querySelectorAll('[class*="etDetail"]')).toHaveLength(1))
  })

  it('closes on a second click', async () => {
    render(<DockEarnings sym="MU" />)
    const q3 = await screen.findByText('FY2026 Q3')
    const row = q3.closest('[class*="etRow"]')
    fireEvent.click(row)
    await waitFor(() => expect(document.querySelector('[class*="etDetail"]')).toBeTruthy())
    fireEvent.click(row)
    await waitFor(() => expect(document.querySelector('[class*="etDetail"]')).toBeNull())
  })

  it('does not expand an estimate row — there is no actual to compare', async () => {
    render(<DockEarnings sym="MU" />)
    const q4 = await screen.findByText('FY2026 Q4')
    fireEvent.click(q4.closest('[class*="etRow"]'))
    expect(document.querySelector('[class*="etDetail"]')).toBeNull()
  })

  it('keeps the filings caveat honest', async () => {
    mockApi({ filings: { filings: [
      { form: '8-K', label: 'Earnings release', url: 'https://x/8k', filed: '2026-06-25' },
      { form: '10-Q', label: 'Quarterly report', url: 'https://x/10q', filed: '2026-07-01' },
    ] } })
    render(<DockEarnings sym="MU" />)
    fireEvent.click((await screen.findByText('FY2026 Q3')).closest('[class*="etRow"]'))
    await waitFor(() => expect(screen.getByText('Open earnings report →')).toBeInTheDocument())
    expect(screen.getByText(/not yet mapped to this specific quarter/)).toBeInTheDocument()
  })
})


describe('history depth', () => {
  it('shows eight reported quarters and offers the rest', async () => {
    const twelve = Array.from({ length: 12 }, (_, i) =>
      quarter(2026 - Math.floor(i / 4), 4 - (i % 4)))
    mockApi({ intel: payload({ quarters: twelve, estimates: [] }) })
    render(<DockEarnings sym="MU" />)
    await screen.findByText('Reported')
    expect(rows()).toHaveLength(8)
    fireEvent.click(screen.getByText('Show 4 more'))
    await waitFor(() => expect(rows()).toHaveLength(12))
  })

  it('offers nothing extra when there is no deeper history', async () => {
    mockApi()
    render(<DockEarnings sym="MU" />)
    await screen.findByText('FY2026 Q3')
    expect(screen.queryByText(/Show \d+ more/)).toBeNull()
  })
})


describe('annual mode', () => {
  const annual = payload({
    annual: {
      estimates: [{ fiscal_year: 2027, label: 'FY2027', estimate: true, eps: 12, revenue: 5e10, eps_yoy_pct: 20 }],
      reported: [
        { fiscal_year: 2025, label: 'FY2025', estimate: false, eps: 4, revenue: 3e10, eps_yoy_pct: 100 },
        { fiscal_year: 2024, label: 'FY2024', estimate: false, eps: 2, revenue: 2e10, eps_yoy_pct: -20 },
      ],
    },
  })

  it('reuses the same table architecture', async () => {
    mockApi({ intel: annual })
    render(<DockEarnings sym="MU" />)
    await screen.findByText('FY2026 Q3')
    fireEvent.click(screen.getByText('Annual'))
    await screen.findByText('FY2025')
    // Same five columns, only the first one renamed.
    expect(headLabels()).toEqual(['Year', 'EPS', 'EPS YoY', 'Sales', 'Sales YoY'])
    for (const row of rows()) expect(row.children).toHaveLength(5)
  })

  it('keeps the estimates-above-reported structure', async () => {
    mockApi({ intel: annual })
    render(<DockEarnings sym="MU" />)
    await screen.findByText('FY2026 Q3')
    fireEvent.click(screen.getByText('Annual'))
    await screen.findByText('FY2025')
    const labels = [...rows()].map(r => r.querySelector('[class*="etPeriodFull"]').textContent)
    expect(labels).toEqual(['FY2027', 'FY2025', 'FY2024'])
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
