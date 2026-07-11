import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'

// RiskExitsSection (reused unchanged for Exit Quality) imports echarts — stub it
// so the section can mount in jsdom. The check-back branch below never renders a
// chart, but the module-level import still needs to resolve.
vi.mock('echarts-for-react', () => ({ default: () => <div data-testid="echart" /> }))

// PlaybookSection self-fetches (useJ2Playbook + useScope). This shell test only
// cares that the Playbook slot mounts/unmounts with the sub-nav — stub it so we
// don't drag in SWR/account fetching. Its own behavior is covered by
// PlaybookSection.test.jsx.
vi.mock('./PlaybookSection', () => ({
  default: () => <div>Playbook mounted</div>,
}))

// The Edge section now renders EdgeScoreCard, which reads the live Scope via
// useScope (for its Copy-link only — no fetch). Stub it so this shell test
// doesn't drag in account fetching; EdgeScoreCard's own behavior is covered by
// EdgeScoreCard.test.jsx.
vi.mock('../../hooks/useScope', () => ({
  default: () => ({
    scope: { acct: null, from: null, to: null, symbol: null, sides: [], setups: [], tags: [] },
  }),
}))

// P5 A7: Regime is real when the `regime` feature flag is on (default ON). Stub
// the section (its own behavior is covered by RegimeSection.test.jsx) and mock
// the flag so this shell test can flip it to exercise BOTH the real section and
// the coming-soon fallback.
vi.mock('./RegimeSection', () => ({
  default: () => <div>Regime mounted</div>,
}))
// P5 A9: Psychology is real when the `psychology` feature flag is on (default ON).
// Same pattern as Regime — stub the section (covered by PsychologySection.test.jsx)
// and let this shell test flip the flag to exercise real-vs-placeholder.
vi.mock('./PsychologySection', () => ({
  default: () => <div>Psychology mounted</div>,
}))
let regimeFlagOn = true
let psychologyFlagOn = true
vi.mock('../../featureFlags', () => ({
  useFeatureFlag: (name) =>
    name === 'regime' ? regimeFlagOn : name === 'psychology' ? psychologyFlagOn : true,
}))

import InsightsHub from './InsightsHub'

// Surfaces the live querystring so we can assert ?ins= persistence + coexistence.
function LocationProbe() {
  const loc = useLocation()
  return <div data-testid="loc">{loc.search}</div>
}

const analytics = {
  tradeCount: 42,
  edgeScore: {
    score: 1.234,
    components: { winRate: 0.55, profitFactor: 1.8, rConsistency: 0.62, tradeCount: 42 },
  },
  // eligible=0 → RiskExitsSection renders its distinctive check-back state (no chart).
  exitQuality: { coverage: { eligible: 0, computed: 0, optionsExcluded: 0 } },
  attribution: { bySetup: [{ setup: 'VCP', tradeCount: 12, totalPnl: 540, winRate: 0.6 }] },
}

function renderHub({ route = '/journal', data = analytics } = {}) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <InsightsHub analytics={data} />
      <LocationProbe />
    </MemoryRouter>,
  )
}

const NAV_LABELS = ['Playbook', 'Exit Quality', 'Edge', 'Psychology', 'Regime']

beforeEach(() => {
  regimeFlagOn = true
  psychologyFlagOn = true
})

describe('InsightsHub — sub-nav shell', () => {
  it('renders the 5-item Insights sub-nav', () => {
    renderHub()
    for (const label of NAV_LABELS) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
  })

  it('defaults to the Playbook section and mounts only that section', () => {
    renderHub()
    expect(screen.getByText('Playbook mounted')).toBeInTheDocument()
    // No other section mounted.
    expect(screen.queryByText('No closed equity trades yet.')).not.toBeInTheDocument()
    expect(screen.queryByText(/Coming with the psychology release/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Coming with the regime release/i)).not.toBeInTheDocument()
  })

  it('clicking Exit Quality mounts the reused RiskExitsSection', () => {
    renderHub()
    fireEvent.click(screen.getByRole('button', { name: 'Exit Quality' }))
    // RiskExitsSection's honest check-back state (eligible=0).
    expect(screen.getByText('No closed equity trades yet.')).toBeInTheDocument()
    // Playbook unmounted — only one section at a time.
    expect(screen.queryByText('Playbook mounted')).not.toBeInTheDocument()
  })

  it('Psychology mounts the real PsychologySection when the flag is on (default)', () => {
    renderHub()
    fireEvent.click(screen.getByRole('button', { name: 'Psychology' }))
    expect(screen.getByText('Psychology mounted')).toBeInTheDocument()
    // Not the coming-soon fallback when the flag is on.
    expect(screen.queryByText(/Coming with the psychology release/i)).not.toBeInTheDocument()
  })

  it('Psychology falls back to the designed placeholder when the flag is off', () => {
    psychologyFlagOn = false
    renderHub()
    fireEvent.click(screen.getByRole('button', { name: 'Psychology' }))
    expect(screen.getByText(/Coming with the psychology release/i)).toBeInTheDocument()
    expect(screen.queryByText('Psychology mounted')).not.toBeInTheDocument()
    expect(screen.queryByTestId('echart')).not.toBeInTheDocument()
  })

  it('Regime mounts the real RegimeSection when the flag is on (default)', () => {
    renderHub()
    fireEvent.click(screen.getByRole('button', { name: 'Regime' }))
    expect(screen.getByText('Regime mounted')).toBeInTheDocument()
    // Not the coming-soon fallback when the flag is on.
    expect(screen.queryByText(/Coming with the regime release/i)).not.toBeInTheDocument()
  })

  it('Regime falls back to the designed placeholder when the flag is off', () => {
    regimeFlagOn = false
    renderHub()
    fireEvent.click(screen.getByRole('button', { name: 'Regime' }))
    expect(screen.getByText(/Coming with the regime release/i)).toBeInTheDocument()
    expect(screen.queryByText('Regime mounted')).not.toBeInTheDocument()
  })

  it('Edge section renders the score + its 4 components', () => {
    renderHub({ route: '/journal?ins=edge' })
    expect(screen.getByText('1.234')).toBeInTheDocument()
    expect(screen.getByText('Win Rate')).toBeInTheDocument()
    expect(screen.getByText('Profit Factor')).toBeInTheDocument()
    expect(screen.getByText('R Consistency')).toBeInTheDocument()
    expect(screen.getByText('Trades')).toBeInTheDocument()
  })

  it('honors an initial ?ins= from the URL', () => {
    renderHub({ route: '/journal?ins=regime' })
    expect(screen.getByText('Regime mounted')).toBeInTheDocument()
    // Default Playbook not shown.
    expect(screen.queryByText('Playbook mounted')).not.toBeInTheDocument()
  })

  it('persists the selection in ?ins= while preserving ?j2tab=', () => {
    renderHub({ route: '/journal?j2tab=journal' })
    fireEvent.click(screen.getByRole('button', { name: 'Edge' }))
    const search = screen.getByTestId('loc').textContent
    expect(search).toContain('ins=edge')
    expect(search).toContain('j2tab=journal')
  })

  it('preserves scope (sc_*) params when writing ?ins=', () => {
    renderHub({ route: '/journal?j2tab=analytics&sc_setup=VCP&sc_v=1' })
    fireEvent.click(screen.getByRole('button', { name: 'Exit Quality' }))
    const search = screen.getByTestId('loc').textContent
    expect(search).toContain('ins=exit')
    expect(search).toContain('sc_setup=VCP')
    expect(search).toContain('sc_v=1')
    expect(search).toContain('j2tab=analytics')
  })

  it('mounts exactly one section at a time (Edge → nothing else)', () => {
    renderHub({ route: '/journal?ins=edge' })
    expect(screen.getByText('Win Rate')).toBeInTheDocument()
    expect(screen.queryByText('Playbook mounted')).not.toBeInTheDocument()
    expect(screen.queryByText('No closed equity trades yet.')).not.toBeInTheDocument()
    expect(screen.queryByText(/Coming with the/i)).not.toBeInTheDocument()
  })

  it('renders no emoji (all iconography via UIcon)', () => {
    const { container } = renderHub()
    expect(container.textContent).not.toMatch(/\p{Extended_Pictographic}/u)
  })
})
