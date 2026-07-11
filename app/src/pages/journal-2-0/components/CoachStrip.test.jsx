/**
 * CoachStrip (B2) — the consolidated coach strip that folds the banner pile.
 *
 * These tests mock the union sources (nudges / interventions / broker-review /
 * unviewed EOD / discipline lock) and assert:
 *   - a nudge + intervention + broker-review render as CONSISTENT rows,
 *     severity-ordered with the discipline lock first
 *   - dismiss on an intervention calls its dismiss; snooze on a nudge works
 *   - NULL when every source is empty (the calm-surface guarantee)
 *   - a deep-link row navigates to the right surface
 *   - no emoji
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// ── controllable mock state ──────────────────────────────────────────────────
let accountId = 'a1'
let nudges = null
let interventions = []
let unviewed = null
let disciplineState = null
let brokerData = { total: 0 }
let overview = null

const dismissIntervention = vi.fn()
const markViewed = vi.fn(() => Promise.resolve())
const navSpy = vi.fn()

vi.mock('../hooks/useJ2SelectedAccount', () => ({
  default: () => ({ accountId, account: null, accounts: [], setAccount: vi.fn(), isLoading: false }),
}))
vi.mock('../hooks/useJ2Nudges', () => ({ default: () => ({ nudges }) }))
vi.mock('../hooks/useInterventions', () => ({
  default: () => ({ interventions, dismiss: dismissIntervention, refresh: vi.fn() }),
}))
vi.mock('../hooks/useJ2UnviewedEOD', () => ({ default: () => ({ unviewed }) }))
vi.mock('../hooks/useJ2EODRecaps', () => ({ default: () => ({ markViewed }) }))
vi.mock('../hooks/useJ2DisciplineState', () => ({ default: () => ({ state: disciplineState }) }))
vi.mock('../hooks/useCompassOverview', () => ({ default: () => ({ overview }) }))
vi.mock('swr', () => ({ default: () => ({ data: brokerData }) }))
vi.mock('react-router-dom', () => ({ useNavigate: () => navSpy }))

import CoachStrip from './CoachStrip'

beforeEach(() => {
  accountId = 'a1'
  nudges = null
  interventions = []
  unviewed = null
  disciplineState = null
  brokerData = { total: 0 }
  overview = null
  dismissIntervention.mockClear()
  markViewed.mockClear()
  navSpy.mockClear()
  localStorage.clear()
})

describe('CoachStrip — union + severity ordering', () => {
  it('renders nudge + intervention + broker-review as consistent rows, discipline lock first', () => {
    disciplineState = { locked: true, reasons: [{ type: 'daily_loss', message: 'Daily loss cap hit.' }] }
    interventions = [{ id: 'iv1', rule: 'loss_streak', severity: 'warning', message: 'Three losers in a row.' }]
    brokerData = { total: 2 }
    nudges = { lossStreakCount: 3, winStreakCount: 0, staleCount: 0, thresholds: { loss: 3, win: 5, staleDays: 30 } }

    render(<CoachStrip />)

    const rows = screen.getAllByTestId('coach-row')
    // one row per source: lock, intervention, review, nudge(loss)
    expect(rows).toHaveLength(4)
    // every row shares the same consistent base testid + role
    rows.forEach((r) => expect(r).toHaveAttribute('role', 'status'))
    // severity order: discipline lock is first
    expect(rows[0]).toHaveAttribute('data-kind', 'lock')
    const kinds = rows.map((r) => r.getAttribute('data-kind'))
    expect(kinds).toEqual(['lock', 'intervention', 'review', 'nudge'])
  })

  it('orders interventions danger before warning within the group', () => {
    interventions = [
      { id: 'w', rule: 'x', severity: 'warning', message: 'warn msg' },
      { id: 'd', rule: 'y', severity: 'danger', message: 'danger msg' },
    ]
    render(<CoachStrip />)
    const rows = screen.getAllByTestId('coach-row')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('danger msg')
    expect(rows[1]).toHaveTextContent('warn msg')
  })
})

describe('CoachStrip — dismiss / snooze semantics', () => {
  it('dismiss on an intervention calls its dismiss with the id', () => {
    interventions = [{ id: 'iv7', rule: 'rapid_fire', severity: 'danger', message: 'Slow down.' }]
    render(<CoachStrip />)
    fireEvent.click(screen.getByRole('button', { name: /dismiss intervention/i }))
    expect(dismissIntervention).toHaveBeenCalledWith('iv7')
  })

  it('snooze on a nudge removes the row (localStorage-backed)', () => {
    nudges = { lossStreakCount: 4, winStreakCount: 0, staleCount: 0, thresholds: { loss: 3, win: 5, staleDays: 30 } }
    render(<CoachStrip />)
    expect(screen.getByText(/4 down today/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /snooze loss-streak nudge/i }))
    expect(screen.queryByText(/4 down today/i)).not.toBeInTheDocument()
    // persisted so the Open Positions strip stays in sync
    expect(localStorage.getItem('uct.j2.nudges.dismissed.a1')).toContain('loss')
  })
})

describe('CoachStrip — calm surface', () => {
  it('renders null when every source is empty', () => {
    render(<CoachStrip />)
    expect(screen.queryByTestId('coach-strip')).not.toBeInTheDocument()
  })
})

describe('CoachStrip — deep-links', () => {
  it('broker-review row navigates to the closed-trades surface', () => {
    brokerData = { total: 1 }
    render(<CoachStrip />)
    fireEvent.click(screen.getByRole('button', { name: /tag in trade journal/i }))
    expect(navSpy).toHaveBeenCalledWith('/journal/trades?seg=closed')
  })

  it('EOD recap row navigates to Compass AND marks the recap viewed', () => {
    unviewed = { id: 'r9', day: '2026-07-10' }
    render(<CoachStrip />)
    fireEvent.click(screen.getByRole('button', { name: /read recap/i }))
    expect(markViewed).toHaveBeenCalledWith('r9')
    expect(navSpy).toHaveBeenCalledWith('/journal/compass')
  })
})

describe('CoachStrip — celebrations (P6-7)', () => {
  it('renders a celebration from the overview as a success row', () => {
    overview = {
      celebrations: [
        { key: 'goal_daily_2026-07-11', kind: 'goal', message: 'Daily goal hit — $540. Bank it.' },
      ],
    }
    render(<CoachStrip />)
    const rows = screen.getAllByTestId('coach-row')
    const cel = rows.find((r) => r.getAttribute('data-kind') === 'celebration')
    expect(cel).toBeTruthy()
    expect(cel).toHaveAttribute('role', 'status')
    expect(cel).toHaveTextContent('Daily goal hit — $540. Bank it.')
  })

  it('flag off → celebration rows are not rendered', () => {
    localStorage.setItem('uct.j2.feature.celebrate', '0')
    overview = {
      celebrations: [
        { key: 'winstreak_6', kind: 'streak', message: '6 wins in a row — the process is working.' },
      ],
    }
    render(<CoachStrip />)
    expect(screen.queryByText(/6 wins in a row/i)).not.toBeInTheDocument()
    expect(screen.queryByTestId('coach-strip')).not.toBeInTheDocument()
  })

  it('a celebration is purely additive — other rows still render', () => {
    brokerData = { total: 1 }
    overview = {
      celebrations: [
        { key: 'cleanday_2026-07-11', kind: 'discipline', message: "Full session, no discipline breaches. That's the edge." },
      ],
    }
    render(<CoachStrip />)
    const kinds = screen.getAllByTestId('coach-row').map((r) => r.getAttribute('data-kind'))
    expect(kinds).toContain('review')
    expect(kinds).toContain('celebration')
  })
})

describe('CoachStrip — no emoji', () => {
  it('renders no emoji glyphs anywhere in the strip', () => {
    disciplineState = { locked: true, reasons: [{ type: 'cooling_off', message: 'Cooling off.' }] }
    interventions = [{ id: 'iv1', rule: 'x', severity: 'info', message: 'Heads up.' }]
    brokerData = { total: 3 }
    nudges = { lossStreakCount: 5, winStreakCount: 6, staleCount: 2, thresholds: { loss: 3, win: 5, staleDays: 30 } }
    unviewed = { id: 'r1', day: '2026-07-10' }

    const { container } = render(<CoachStrip />)
    expect(container.textContent).not.toMatch(/\p{Extended_Pictographic}/u)
  })
})
