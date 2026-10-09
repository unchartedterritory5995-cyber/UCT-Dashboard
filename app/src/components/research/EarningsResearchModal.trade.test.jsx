// Wave 3 lane 13 (#8): the CAL / ERN row detail opens with the earnings-trade sentence, from the
// numbers the calendar row already carries (enrichment `expected_move.pct` + `hist_stats.last_n`),
// and never for a report that has already printed (its live straddle is IV-crushed).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AuthProvider } from '../../context/AuthContext'
import EarningsResearchModal from './EarningsResearchModal'

vi.mock('../../hooks/useExpectedMove', () => ({ default: () => ({ data: { live: { pct: 99 }, history: [], grade: null }, isLoading: false }) }))
vi.mock('./sections/SetupSection', () => ({ default: () => <div data-testid="panel-setup" /> }))
vi.mock('../../hooks/useLivePrices', () => ({ default: () => ({ prices: {} }) }))

const MOVES = [8.1, -3.2, 9.0, -2.1, 4.0, -7.5, 3.3, -6.0]
const base = { sym: 'NVDA', company: 'NVIDIA Corporation', verdict: 'pending', eps_estimate: 0.94,
  expected_move: { pct: 7.1 }, hist_stats: { avg_abs_move: 5.4, up_count: 4, total: 8, last_n: MOVES } }

const renderModal = (row) => render(
  <AuthProvider><MemoryRouter>
    <EarningsResearchModal row={row} label="AFTER MARKET CLOSE" reportDate="2026-11-19" timing="amc"
      section={null} onSectionChange={() => {}} onClose={() => {}} onStepPrev={null} onStepNext={null}
      stepping={false} onPollActuals={null} nowMs={Date.parse('2026-11-10T12:00:00-05:00')} />
  </MemoryRouter></AuthProvider>,
)

beforeEach(() => { global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: async () => ({}) })) })

describe('ERN / CAL row detail: the earnings trade', () => {
  it('states the calendar row\'s own implied move against its own past reactions', () => {
    renderModal({ ...base, reported_eps: null })
    expect(screen.getByTestId('earnings-trade-card').textContent).toContain(
      "Options price a ±7.1% move; NVDA has moved ±5.4% on average over its last 8 reports (more than today's implied move 3 of 8 times).")
  })

  it('is absent once the company has reported', () => {
    renderModal({ ...base, reported_eps: 1.02 })
    expect(screen.queryByTestId('earnings-trade-card')).toBeNull()
  })
})
