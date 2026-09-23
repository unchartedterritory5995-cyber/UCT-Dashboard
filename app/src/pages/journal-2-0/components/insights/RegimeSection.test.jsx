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
    expect(screen.getByText(/without an Exposure Backdrop tag/i)).toBeInTheDocument()
    expect(screen.getByText(/7 trades without an Exposure Backdrop tag/i)).toBeInTheDocument()
  })

  it('hides the unknown footnote when unknownCount is 0', () => {
    renderSection({ regime: { byRegime: analytics.regime.byRegime, unknownCount: 0 } })
    expect(screen.queryByText(/without an Exposure Backdrop tag/i)).not.toBeInTheDocument()
  })

  it('empty byRegime → an honest empty message, not a bare blank', () => {
    renderSection({ regime: { byRegime: [], unknownCount: 0 } })
    expect(screen.getByText(/Not enough Exposure-Backdrop-tagged trades yet/i)).toBeInTheDocument()
    // No regime rows rendered.
    expect(screen.queryByText('Win Rate')).not.toBeInTheDocument()
  })

  it('exposes a "What is Exposure Backdrop?" control that reveals the explanation', () => {
    renderSection()
    const btn = screen.getByRole('button', { name: /what is exposure backdrop/i })
    expect(btn).toBeInTheDocument()
    // Explanation hidden until opened.
    expect(screen.queryByText(/how friendly market/i)).not.toBeInTheDocument()
    fireEvent.click(btn)
    expect(screen.getByText(/how friendly market/i)).toBeInTheDocument()
  })

  it('is resilient to a missing regime slice (renders the empty state)', () => {
    renderSection({})
    expect(screen.getByText(/Not enough Exposure-Backdrop-tagged trades yet/i)).toBeInTheDocument()
  })

  it('renders no emoji (all iconography via UIcon)', () => {
    const { container } = renderSection()
    expect(container.textContent).not.toMatch(/\p{Extended_Pictographic}/u)
  })

  // PACKET-W CP1 (fingerprint 425778f2c): the word "regime" is retired from
  // every rendered string -- the bucket keys (green/amber/orange/red) and the
  // `regime`/`byRegime` field names are untouched, but a member reading the
  // screen should never see the bare word. Header, help toggle, help body
  // (opened), empty state and footnote are all covered.
  it('never renders the bare word "regime" anywhere a member reads', () => {
    const { container } = renderSection()
    const helpBtn = screen.getByRole('button', { name: /what is exposure backdrop/i })
    fireEvent.click(helpBtn)
    expect(container.textContent).not.toMatch(/\bregimes?\b/i)
  })

  it('never renders "regime" in the empty state either', () => {
    const { container } = renderSection({ regime: { byRegime: [], unknownCount: 0 } })
    expect(container.textContent).not.toMatch(/\bregimes?\b/i)
  })
})
