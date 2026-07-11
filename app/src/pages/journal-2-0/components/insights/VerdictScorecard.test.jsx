import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

// VerdictScorecard reads its slice from useVerdictScorecard (SWR over the P6-2
// endpoint). Stub the hook so the presentational component can be exercised with
// canned data — its fetch/Scope shape is covered by the hook's own path.
let mockResult = { data: null, isLoading: false, error: null, allAccounts: false }
vi.mock('../../hooks/useVerdictScorecard', () => ({
  default: () => mockResult,
}))

import VerdictScorecard from './VerdictScorecard'

// Full scorecard: GO/HOLD taken buckets, a SKIP overridden bucket, an override
// headline, and coverage. GO is confident (n>=10); SKIP is a thin sample (n<10).
const fullData = {
  byVerdict: [
    { label: 'GO', taken: { n: 24, winRate: 0.62, avgR: 0.8, netPnl: 1240.5 } },
    { label: 'HOLD', taken: { n: 12, winRate: 0.5, avgR: 0.1, netPnl: 60 } },
    { label: 'SKIP', overridden: { n: 8, winRate: 0.25, avgR: -0.6, netPnl: -820 }, obeyed: 15 },
  ],
  coverage: { tradesWithVerdict: 44, tradesTotal: 60 },
  skipOverrideHeadline: { n: 8, lossRate: 0.75, losses: 6, decisive: 8, netPnl: -820 },
}

function renderCard(data) {
  mockResult = { data, isLoading: false, error: null, allAccounts: false }
  return render(<VerdictScorecard accountId="acc1" apiParams={{}} />)
}

beforeEach(() => {
  mockResult = { data: null, isLoading: false, error: null, allAccounts: false }
})

describe('VerdictScorecard', () => {
  it('renders the three verdict rows and the override headline from the mock', () => {
    renderCard(fullData)
    expect(screen.getByText('GO')).toBeInTheDocument()
    expect(screen.getByText('HOLD')).toBeInTheDocument()
    expect(screen.getByText('SKIP')).toBeInTheDocument()
    // Each row exposes the confidence-shaded win-rate stat.
    expect(screen.getAllByText('Win Rate').length).toBe(3)
    // Win-rate values render.
    expect(screen.getByText('62%')).toBeInTheDocument()
    expect(screen.getByText('25%')).toBeInTheDocument()
    // The red-toned override headline: total overrides (n=8, breakevens incl.)
    // but the honest decisive count — "lost {losses} of {decisive}" — plus money.
    expect(
      screen.getByText(/overrode Compass.s SKIP 8 times .* lost 6 of the 8 you took to a decision \(-\$820\.00\)/i),
    ).toBeInTheDocument()
    // The obeyed-SKIP aside.
    expect(screen.getByText(/obeyed 15/i)).toBeInTheDocument()
  })

  it('grays a bucket with n<10 and leaves a confident one un-dimmed', () => {
    renderCard(fullData)
    // GO n=24 → confident, NOT dimmed.
    expect(screen.getByText('62%').className).not.toMatch(/dim/)
    // SKIP overridden n=8 → the same value, but grayed as a low-confidence estimate.
    expect(screen.getByText('25%').className).toMatch(/dim/)
  })

  it('coverage footnote reflects the with-verdict / total numbers', () => {
    renderCard(fullData)
    expect(screen.getByText(/Scored from 44 of 60 closed trades/i)).toBeInTheDocument()
    expect(screen.getByText(/carry a verdict/i)).toBeInTheDocument()
  })

  it('hides the override headline when skipOverrideHeadline is null', () => {
    renderCard({ ...fullData, skipOverrideHeadline: null })
    expect(screen.queryByText(/overrode Compass/i)).not.toBeInTheDocument()
    // Rows still render.
    expect(screen.getByText('GO')).toBeInTheDocument()
    expect(screen.getByText('SKIP')).toBeInTheDocument()
  })

  it('tradesWithVerdict:0 → the pitch card, never a fake 0% scorecard', () => {
    renderCard({
      byVerdict: [
        { label: 'GO', taken: { n: 0, winRate: null, avgR: null, netPnl: 0 } },
        { label: 'HOLD', taken: { n: 0, winRate: null, avgR: null, netPnl: 0 } },
        { label: 'SKIP', overridden: { n: 0, winRate: null, avgR: null, netPnl: 0 }, obeyed: 0 },
      ],
      coverage: { tradesWithVerdict: 0, tradesTotal: 30 },
      skipOverrideHeadline: null,
    })
    // The pitch, not the scorecard.
    expect(screen.getByText(/this scorecard comes alive/i)).toBeInTheDocument()
    // No fake 0% and no verdict rows / footnote.
    expect(screen.queryByText('0%')).not.toBeInTheDocument()
    expect(screen.queryByText('Win Rate')).not.toBeInTheDocument()
    expect(screen.queryByText(/Scored from/i)).not.toBeInTheDocument()
  })

  it('shows an all-accounts note instead of the scorecard', () => {
    mockResult = { data: null, isLoading: false, error: null, allAccounts: true }
    render(<VerdictScorecard accountId={null} apiParams={{}} />)
    expect(screen.getByText(/Select a single account/i)).toBeInTheDocument()
    expect(screen.queryByText('Win Rate')).not.toBeInTheDocument()
  })

  it('renders no emoji (all iconography via UIcon)', () => {
    const { container } = renderCard(fullData)
    expect(container.textContent).not.toMatch(/\p{Extended_Pictographic}/u)
  })
})
