/** MetricsDashboard — cards render from the batched payload; honest gates. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import MetricsDashboard from './MetricsDashboard'

const PREFS = { j2_custom_dashboard: { cards: ['consistency', 'payoff_kelly'], kpis: [{ name: 'edge', expr: 'net_pnl / trades' }] } }
vi.mock('../../../../hooks/usePreferences', () => ({
  __esModule: true,
  default: () => ({ prefs: { j2_custom_dashboard: JSON.stringify(PREFS.j2_custom_dashboard) }, setPref: vi.fn() }),
  parsePref: (raw, fallback) => {
    try { return raw ? JSON.parse(raw) : fallback } catch { return fallback }
  },
}))

const REGISTRY = [
  { key: 'consistency', title: 'Consistency', description: 'x', category: 'discipline' },
  { key: 'payoff_kelly', title: 'Payoff & Kelly', description: 'x', category: 'risk' },
  { key: 'risk_ratios', title: 'Sharpe / Sortino / Calmar', description: 'x', category: 'risk' },
  { key: 'custom', title: 'Custom KPI', description: 'x', category: 'custom', vocabulary: ['net_pnl', 'trades'] },
]
const METRICS = {
  metrics: {
    consistency: {
      tradingDays: 12, profitableDayPct: 0.75, dailyStdev: 210.5,
      largestDayShare: 0.4, top3DayShare: 0.7,
      bestDay: { date: '2026-08-01', pnl: 900 }, worstDay: { date: '2026-08-04', pnl: -300 },
    },
    payoff_kelly: {
      decisive: 8, minDecisive: 20, winRate: 0.75, avgWin: 200, avgLoss: 100,
      payoff: 2, kelly: null, halfKelly: null,
    },
  },
  custom: [{ name: 'edge', expr: 'net_pnl / trades', value: 42.5, error: null }],
  unknownKeys: [],
  tradeCount: 20,
  rSources: { stop: 5, trueR: 15, none: 0 },
}

beforeEach(() => {
  global.fetch = vi.fn((url) => Promise.resolve({
    ok: true,
    json: () => Promise.resolve(String(url).includes('/registry') ? REGISTRY : METRICS),
  }))
})

describe('MetricsDashboard', () => {
  it('renders selected cards with their values + the scope note', async () => {
    render(<MetricsDashboard apiParams={{}} />)
    expect(await screen.findByText('Consistency')).toBeInTheDocument()
    // 75.0% appears in BOTH cards (profitable days + win rate) — both real
    expect(screen.getAllByText('75.0%').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText(/20 trades in scope/)).toBeInTheDocument()
    expect(screen.getByText(/True R feeds 15/)).toBeInTheDocument()
  })

  it('shows the honest Kelly gate note instead of a fabricated number', async () => {
    render(<MetricsDashboard apiParams={{}} />)
    expect(await screen.findByText(/Kelly needs 20 decisive trades — 8 so far/)).toBeInTheDocument()
  })

  it('renders custom KPI results and the vocabulary hint', async () => {
    render(<MetricsDashboard apiParams={{}} />)
    expect(await screen.findByText('edge')).toBeInTheDocument()
    expect(screen.getByText('42.5')).toBeInTheDocument()
    expect(screen.getByText(/Variables: net_pnl · trades/)).toBeInTheDocument()
  })

  it('offers only not-yet-added cards in the picker', async () => {
    render(<MetricsDashboard apiParams={{}} />)
    await screen.findByText('Consistency')
    const options = screen.getAllByRole('option').map((o) => o.textContent)
    expect(options).toContain('Sharpe / Sortino / Calmar')
    expect(options).not.toContain('Consistency')
  })
})
