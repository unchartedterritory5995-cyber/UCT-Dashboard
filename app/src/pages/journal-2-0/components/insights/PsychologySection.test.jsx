import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

// PsychologySection is presentational — it reads `analytics.psychology` and
// persists revenge dismissals to localStorage. No router, no hooks to mock.
import PsychologySection from './PsychologySection'

const DISMISS_KEY = 'uct.j2.revengeDismissed'

const psychology = {
  emotionOutcomes: [
    // confident (n >= 10): win rate renders un-dimmed; net-positive → green bar
    { emotion: 'calm', tradeCount: 12, avgPnl: 85.5, winRate: 0.66 },
    // thin sample (n < 10 AND n < 3): win rate grayed AND "thin sample" annotated
    { emotion: 'anxious', tradeCount: 2, avgPnl: -12.0, winRate: 0.0 },
    // thin-ish (n < 10, n >= 3): win rate grayed, but not a "thin sample"
    { emotion: 'greedy', tradeCount: 8, avgPnl: -40.0, winRate: 0.25 },
  ],
  costOfMistakes: {
    total: -145.0,
    byMistake: [
      { mistake: 'fomo', total: -145.0, count: 2 },
      { mistake: 'chasing', total: -40.0, count: 1 },
    ],
  },
  revenge: {
    flags: [
      { symbol: 'NVDA', prevTradeRef: 'a', tradeRef: 'b', minutesApart: 12.5, pairKey: 'a->b' },
      { symbol: 'TSLA', prevTradeRef: 'c', tradeRef: 'd', minutesApart: 30, pairKey: 'c->d' },
    ],
    timeComponentCoverage: { timed: 20, total: 20 },
  },
  tilt: { byDay: {} },
  taggedTradeCount: 20,
}

function renderSection(overrides = {}, props = {}) {
  const analytics = { psychology: { ...psychology, ...overrides } }
  return render(<PsychologySection analytics={analytics} {...props} />)
}

beforeEach(() => {
  localStorage.clear()
  // The pitch card now mounts RapidTagFlow, which fetches recent trades + reads
  // settings via SWR. Stub fetch so opening the flow is deterministic (empty
  // trades → the flow's friendly empty state; no real network).
  global.fetch = vi.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({ trades: [] }) }),
  )
})

describe('PsychologySection', () => {
  it('renders all three panels from analytics.psychology', () => {
    renderSection()
    // Panel 1 — emotion×outcome
    expect(screen.getByText(/emotion .* outcome/i)).toBeInTheDocument()
    expect(screen.getByText('calm')).toBeInTheDocument()
    expect(screen.getByText('greedy')).toBeInTheDocument()
    // Panel 2 — cost of mistakes
    expect(screen.getByText(/cost of mistakes/i)).toBeInTheDocument()
    // Panel 3 — revenge / tilt
    expect(screen.getByText(/revenge .* tilt/i)).toBeInTheDocument()
  })

  it('grays a thin-sample emotion (tradeCount < 3) and annotates it', () => {
    renderSection()
    // anxious has 2 trades → the "thin sample" annotation chip surfaces (exact
    // match so it doesn't also catch the panel subtitle that mentions the phrase).
    expect(screen.getByText('thin sample')).toBeInTheDocument()
    // calm (n=12) win rate is confident → NOT dimmed; greedy (n=8) is dimmed.
    expect(screen.getByText('66%').className).not.toMatch(/dim/)
    expect(screen.getByText('25%').className).toMatch(/dim/)
  })

  it('shows the cost-of-mistakes headline + per-mistake breakdown', () => {
    renderSection()
    expect(screen.getByText(/bled on mistake-tagged trades/i)).toBeInTheDocument()
    // -$145.00 appears twice: the headline net total AND the fomo row (fomo is
    // tagged on both losing trades — mirrors the backend's per-tag accumulation).
    expect(screen.getAllByText('-$145.00').length).toBeGreaterThanOrEqual(2)
    // breakdown rows
    expect(screen.getByText('fomo')).toBeInTheDocument()
    expect(screen.getByText('chasing')).toBeInTheDocument()
    expect(screen.getByText('-$40.00')).toBeInTheDocument()
  })

  it('lists revenge flags and "Not revenge" dismisses one + persists it', () => {
    renderSection()
    expect(screen.getByText('NVDA')).toBeInTheDocument()
    expect(screen.getByText('TSLA')).toBeInTheDocument()

    // Dismiss the NVDA flag (first dismiss button, flags render in array order).
    const dismissButtons = screen.getAllByRole('button', { name: /not revenge/i })
    fireEvent.click(dismissButtons[0])

    // NVDA gone from the DOM, TSLA remains.
    expect(screen.queryByText('NVDA')).not.toBeInTheDocument()
    expect(screen.getByText('TSLA')).toBeInTheDocument()

    // Persisted to localStorage under the documented key.
    const stored = JSON.parse(localStorage.getItem(DISMISS_KEY))
    expect(stored).toContain('a->b')
  })

  it('hides a pre-dismissed flag on initial render (reads localStorage)', () => {
    localStorage.setItem(DISMISS_KEY, JSON.stringify(['a->b']))
    renderSection()
    expect(screen.queryByText('NVDA')).not.toBeInTheDocument()
    expect(screen.getByText('TSLA')).toBeInTheDocument()
  })

  it('date-only book (timed === 0) → "needs execution times", not a clean list', () => {
    renderSection({
      revenge: { flags: [], timeComponentCoverage: { timed: 0, total: 14 } },
    })
    expect(screen.getByText(/needs execution times/i)).toBeInTheDocument()
    expect(screen.queryByText(/no revenge patterns detected/i)).not.toBeInTheDocument()
  })

  it('timed coverage but no flags → an honest "no revenge" message', () => {
    renderSection({
      revenge: { flags: [], timeComponentCoverage: { timed: 20, total: 20 } },
    })
    expect(screen.getByText(/no revenge patterns detected/i)).toBeInTheDocument()
    expect(screen.queryByText(/needs execution times/i)).not.toBeInTheDocument()
  })

  it('taggedTradeCount === 0 → the pitch card; its button calls onStartRapidTag', async () => {
    const onStartRapidTag = vi.fn()
    renderSection({ taggedTradeCount: 0 }, { onStartRapidTag })
    // The three data panels are replaced by the pitch card.
    expect(screen.queryByText(/emotion .* outcome/i)).not.toBeInTheDocument()
    expect(screen.getByText(/tag your last 20 trades/i)).toBeInTheDocument()

    const btn = screen.getByRole('button', { name: /tag my trades/i })
    fireEvent.click(btn)
    expect(onStartRapidTag).toHaveBeenCalledTimes(1)
    // The click also opens the flow — settle its async load (stubbed empty).
    await screen.findByText(/no closed trades to tag yet/i)
  })

  it('pitch-card button is a harmless no-op when onStartRapidTag is absent', async () => {
    renderSection({ taggedTradeCount: 0 })
    const btn = screen.getByRole('button', { name: /tag my trades/i })
    expect(() => fireEvent.click(btn)).not.toThrow()
    // Let the mounted flow settle (fetch → empty state) so no act() leaks.
    await screen.findByText(/no closed trades to tag yet/i)
  })

  it('clicking the pitch-card button opens the RapidTagFlow', async () => {
    renderSection({ taggedTradeCount: 0 })
    // Flow not mounted until the pitch button is pressed.
    expect(screen.queryByText(/tag recent trades/i)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /tag my trades/i }))
    // The flow's Sheet (portaled to document.body) mounts with its own title.
    expect(screen.getByText(/tag recent trades/i)).toBeInTheDocument()
    // Settle the async load (stubbed empty) to avoid an act() warning.
    await screen.findByText(/no closed trades to tag yet/i)
  })

  it('is resilient to a missing psychology slice (no crash, no data panels)', () => {
    render(<PsychologySection analytics={{}} />)
    // Empty book → taggedTradeCount defaults to 0 → the pitch card.
    expect(screen.getByText(/tag your last 20 trades/i)).toBeInTheDocument()
  })

  it('shows a "Make this a rule" action on each mistake row when an account is set (P6-6)', async () => {
    // With an accountId + the makeRule flag on (default), each cost-of-mistakes
    // row carries the affordance; the "My rules" area appears below the panels.
    renderSection({}, { accountId: 'acc1' })
    const actions = screen.getAllByText(/make this a rule/i)
    expect(actions.length).toBe(2) // one per mistake row (fomo, chasing)
    // The co-located rules list (empty → its muted invitation) renders below.
    expect(screen.getByText(/turn a recurring mistake into a rule above/i)).toBeInTheDocument()
    // Flush the co-located rules GETs so their state updates settle in act.
    await act(async () => {})
  })

  it('omits the Make-rule affordance when no account is selected', () => {
    renderSection() // no accountId
    expect(screen.queryByText(/make this a rule/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/turn a recurring mistake into a rule above/i)).not.toBeInTheDocument()
  })

  it('renders no emoji (all iconography via UIcon)', () => {
    const { container } = renderSection()
    expect(container.textContent).not.toMatch(/\p{Extended_Pictographic}/u)
  })
})
