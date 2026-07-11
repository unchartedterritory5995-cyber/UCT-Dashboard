import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// ── Mocks ────────────────────────────────────────────────────────────────────
// PlaybookSection self-fetches via useJ2Playbook + reads/writes scope via
// useScope, and drills through with useNavigate. Mock all three; keep the rest
// of react-router-dom real so MemoryRouter + useSearchParams work.

const setFacet = vi.fn()
const navigate = vi.fn()
let playbookState

vi.mock('../../hooks/useScope', () => ({
  default: () => ({ apiParams: {}, setFacet }),
}))
vi.mock('../../hooks/useJ2Playbook', () => ({
  default: () => playbookState,
}))
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useNavigate: () => navigate }
})

import PlaybookSection from './PlaybookSection'

const VCP = {
  setup: 'VCP',
  tradeCount: 24,
  winCount: 15,
  lossCount: 8,
  beCount: 1,
  winRate: 0.652,
  profitFactor: 2.1,
  expectancy: 88.5,
  expectancyR: 0.9,
  avgR: 0.9,
  totalR: 21.6,
  totalPnlDollar: 2124,
  exitEfficiency: 0.71,
  exitEffCoverage: { eligible: 24, computed: 20 },
  lastFive: ['W', 'W', 'L', 'W', 'B'],
}
const FLAG = {
  setup: 'Flag',
  tradeCount: 5, // n < 10 → shaded
  winCount: 3,
  lossCount: 2,
  beCount: 0,
  winRate: 0.6,
  profitFactor: 1.4,
  expectancy: 42,
  expectancyR: 0.5,
  avgR: 0.5,
  totalR: 2.5,
  totalPnlDollar: 210,
  exitEfficiency: 0.55,
  exitEffCoverage: { eligible: 5, computed: 4 },
  lastFive: ['W', 'L', 'W', 'L', 'W'],
}

function renderSection(route = '/journal?j2tab=analytics') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <PlaybookSection />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  setFacet.mockClear()
  navigate.mockClear()
  playbookState = { stats: [VCP, FLAG], isLoading: false, error: null, allAccounts: false }
})

describe('PlaybookSection', () => {
  it('renders a card per setup from the hook data', () => {
    renderSection()
    expect(screen.getByText('VCP')).toBeInTheDocument()
    expect(screen.getByText('Flag')).toBeInTheDocument()
    // Each card exposes the confidence-shaded stat labels.
    expect(screen.getAllByText('Win Rate').length).toBe(2)
    expect(screen.getAllByText('Profit Factor').length).toBe(2)
    expect(screen.getAllByText('Expectancy').length).toBe(2)
  })

  it('shades a low-confidence (n<10) setup and leaves a confident one un-dimmed', () => {
    const { container } = renderSection()
    // Find each card by its setup name → nearest button (the whole card).
    const flagCard = screen.getByText('Flag').closest('button')
    const vcpCard = screen.getByText('VCP').closest('button')
    expect(flagCard).toBeTruthy()
    expect(vcpCard).toBeTruthy()
    // The n<10 Flag card carries at least one dimmed ConfidenceStat cell.
    expect(flagCard.querySelector('[class*="dim"]')).toBeTruthy()
    // The n=24 VCP card's win-rate cell is NOT dimmed.
    const vcpWinRate = within(vcpCard).getByText('65%')
    expect(vcpWinRate.className).not.toMatch(/dim/)
    // Sanity: the section rendered something.
    expect(container.textContent).toContain('VCP')
  })

  it('withholds exit-efficiency below the P2 coverage gate, shows it when coverage is sufficient', () => {
    const SUFFICIENT = {
      setup: 'HTF',
      tradeCount: 30,
      winRate: 0.6,
      profitFactor: 2,
      expectancy: 100,
      avgR: 1,
      exitEfficiency: 0.82,
      // 29/30 ≥ 0.9 AND computed ≥ 10 → confident number (matches Exit Quality "ready").
      exitEffCoverage: { eligible: 30, computed: 29 },
      lastFive: [],
    }
    const LOW_COVERAGE = {
      setup: 'ORB',
      tradeCount: 30,
      winRate: 0.6,
      profitFactor: 2,
      expectancy: 100,
      avgR: 1,
      exitEfficiency: 0.77,
      // computed ≥ 10 but 15/30 = 0.5 < 0.9 → withheld (matches Exit Quality "check back").
      exitEffCoverage: { eligible: 30, computed: 15 },
      lastFive: [],
    }
    playbookState = { stats: [SUFFICIENT, LOW_COVERAGE], isLoading: false, error: null, allAccounts: false }
    renderSection()

    const sufficientCard = screen.getByText('HTF').closest('button')
    const lowCard = screen.getByText('ORB').closest('button')

    // Sufficient coverage → the exit-eff number renders and is NOT dimmed.
    const sufValue = within(sufficientCard).getByText('82%')
    expect(sufValue.className).not.toMatch(/dim/)

    // Low coverage → the confident number is withheld; the exit-eff cell falls
    // back to the honest dim "—" state (so it can't contradict Exit Quality).
    expect(within(lowCard).queryByText('77%')).toBeNull()
    const exitEffCell = within(lowCard).getByText('Exit Eff.').parentElement
    expect(exitEffCell.querySelector('[class*="dim"]')).toBeTruthy()
  })

  it('drill-through: clicking a card sets the setup scope + routes to the journal tab', () => {
    renderSection()
    fireEvent.click(screen.getByText('VCP').closest('button'))
    expect(setFacet).toHaveBeenCalledWith('setups', ['VCP'])
    expect(navigate).toHaveBeenCalledTimes(1)
    const target = navigate.mock.calls[0][0]
    expect(target).toContain('j2tab=journal')
    expect(target).toContain('sc_setup=VCP')
  })

  it('drill-through works via keyboard (the card is a native button)', () => {
    renderSection()
    const card = screen.getByText('Flag').closest('button')
    expect(card.tagName).toBe('BUTTON')
    fireEvent.click(card) // Enter/Space fire click on a native button
    expect(setFacet).toHaveBeenCalledWith('setups', ['Flag'])
  })

  it('empty stats → a friendly empty state (not a bare blank)', () => {
    playbookState = { stats: [], isLoading: false, error: null, allAccounts: false }
    renderSection()
    expect(screen.getByText(/No setup performance yet/i)).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('all-accounts → the "pick one account" note', () => {
    playbookState = { stats: [], isLoading: false, error: null, allAccounts: true }
    renderSection()
    expect(screen.getByText(/select a single account/i)).toBeInTheDocument()
    expect(screen.queryByText(/No setup performance yet/i)).not.toBeInTheDocument()
  })

  it('renders no emoji (all iconography via UIcon)', () => {
    const { container } = renderSection()
    expect(container.textContent).not.toMatch(/\p{Extended_Pictographic}/u)
  })
})
