import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// RegimeSection is presentational — it reads `analytics.regime` and uses only
// local state (the popover toggle). No router, no hooks to mock.
import RegimeSection from './RegimeSection'

const analytics = {
  regime: {
    byRegime: [
      // confident (n >= 10): win rate renders un-dimmed
      { regime: 'green', tradeCount: 24, winRate: 0.65, avgR: 0.9, expectancy: 88.5 },
      // thin sample (n < 10): win rate must be grayed
      { regime: 'red', tradeCount: 5, winRate: 0.4, avgR: -0.3, expectancy: -40 },
    ],
    unknownCount: 7,
  },
}

function renderSection(data = analytics) {
  return render(<RegimeSection analytics={data} />)
}

describe('RegimeSection', () => {
  it('renders a row per regime from analytics.regime.byRegime', () => {
    renderSection()
    expect(screen.getByText('Green')).toBeInTheDocument()
    expect(screen.getByText('Red')).toBeInTheDocument()
    // Each row exposes the confidence-shaded win-rate stat.
    expect(screen.getAllByText('Win Rate').length).toBe(2)
    // Values render.
    expect(screen.getByText('65%')).toBeInTheDocument()
    expect(screen.getByText('40%')).toBeInTheDocument()
  })

  it('grays a bucket with n<10 and leaves a confident one un-dimmed', () => {
    renderSection()
    // n=24 green → confident, NOT dimmed.
    expect(screen.getByText('65%').className).not.toMatch(/dim/)
    // n=5 red → the same value, but grayed as a low-confidence estimate.
    expect(screen.getByText('40%').className).toMatch(/dim/)
  })

  it('shows the unknown-bucket footnote when unknownCount > 0', () => {
    renderSection()
    expect(screen.getByText(/without a regime tag/i)).toBeInTheDocument()
    expect(screen.getByText(/7 trades without a regime tag/i)).toBeInTheDocument()
  })

  it('hides the unknown footnote when unknownCount is 0', () => {
    renderSection({ regime: { byRegime: analytics.regime.byRegime, unknownCount: 0 } })
    expect(screen.queryByText(/without a regime tag/i)).not.toBeInTheDocument()
  })

  it('empty byRegime → an honest empty message, not a bare blank', () => {
    renderSection({ regime: { byRegime: [], unknownCount: 0 } })
    expect(screen.getByText(/Not enough regime-tagged trades yet/i)).toBeInTheDocument()
    // No regime rows rendered.
    expect(screen.queryByText('Win Rate')).not.toBeInTheDocument()
  })

  it('exposes a "What are regimes?" control that reveals the explanation', () => {
    renderSection()
    const btn = screen.getByRole('button', { name: /what are regimes/i })
    expect(btn).toBeInTheDocument()
    // Explanation hidden until opened.
    expect(screen.queryByText(/exposure backdrop the day you entered/i)).not.toBeInTheDocument()
    fireEvent.click(btn)
    expect(screen.getByText(/exposure backdrop the day you entered/i)).toBeInTheDocument()
  })

  it('is resilient to a missing regime slice (renders the empty state)', () => {
    renderSection({})
    expect(screen.getByText(/Not enough regime-tagged trades yet/i)).toBeInTheDocument()
  })

  it('renders no emoji (all iconography via UIcon)', () => {
    const { container } = renderSection()
    expect(container.textContent).not.toMatch(/\p{Extended_Pictographic}/u)
  })
})
