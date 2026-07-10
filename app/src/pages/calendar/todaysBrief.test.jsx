import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../components/CompanyLogo', () => ({ default: () => null }))
// Reactions hook: return a gap for a reported ticker
vi.mock('./useCalendarData', () => ({ useReactions: () => ({ data: { PEP: 4.2 } }) }))

import TodaysBrief from './TodaysBrief'

const TODAY = '2026-07-13'
const TOMORROW = '2026-07-14'
const weekDates = [TODAY, TOMORROW, '2026-07-15', '2026-07-16', '2026-07-17']

function build(overrides = {}) {
  const days = {
    [TODAY]: {
      is_today: true,
      bmo: [
        // my position, not yet reported → YOUR REPORTS
        { sym: 'NVDA', eps_est: 1.2, eps_act: null, mine: true, _sources: ['positions'] },
        // my watchlist name that already reported → REPORTED
        { sym: 'PEP', eps_est: 2.2, eps_act: 2.3, mine: true, _sources: ['watchlist'] },
      ],
      amc: [], tbd: [],
      econ: [{ time: '8:30 AM', event: 'CPI', is_key: true, estimate: '3.2%' },
             { time: '10:00 AM', event: 'Random low', is_key: false }],
      fed: [],
    },
    [TOMORROW]: {
      is_today: false,
      bmo: [{ sym: 'AMD', eps_est: 0.9, eps_act: null, mine: true, _sources: ['uct20'] }],
      amc: [], tbd: [], econ: [], fed: [],
    },
    ...overrides,
  }
  return render(
    <MemoryRouter>
      <TodaysBrief days={days} weekDates={weekDates} todayIso={TODAY} onSelect={vi.fn()} />
    </MemoryRouter>
  )
}

describe('TodaysBrief', () => {
  it('lists my upcoming reporters with source badges (POSITION gold vs UCT20)', () => {
    build()
    expect(screen.getByText('Your reports')).toBeTruthy()
    expect(screen.getByText('NVDA')).toBeTruthy()
    expect(screen.getByText('POSITION')).toBeTruthy()
    // tomorrow's uct20 name is included with its badge
    expect(screen.getByText('AMD')).toBeTruthy()
    expect(screen.getByText('UCT20')).toBeTruthy()
  })

  it('shows reported verdict + live gap for my names that printed', () => {
    build()
    expect(screen.getByText('Reported')).toBeTruthy()
    // PEP beat (2.3 > 2.2) and carries the +4.2% gap from the reactions mock
    expect(screen.getByText('BEAT')).toBeTruthy()
    expect(screen.getByText('+4.2%')).toBeTruthy()
  })

  it('surfaces only KEY macro events today', () => {
    build()
    expect(screen.getByText('Macro today')).toBeTruthy()
    expect(screen.getByText(/CPI/)).toBeTruthy()
    expect(screen.queryByText(/Random low/)).toBeNull()   // non-key filtered out
  })

  it('does NOT render an upcoming reporter that already reported (no double-count)', () => {
    build()
    // PEP already reported → it belongs to REPORTED only, never to YOUR
    // REPORTS. NVDA is the sole unreported *today*-BMO name; AMD is tomorrow.
    expect(screen.getAllByText('today · before open').length).toBe(1)   // NVDA only
    expect(screen.getByText('tomorrow · before open')).toBeTruthy()      // AMD
  })

  it('renders NOTHING when the user has no names + nothing reported (no empty-state band)', () => {
    const { container } = render(
      <MemoryRouter>
        <TodaysBrief
          days={{ [TODAY]: { is_today: true, bmo: [], amc: [], tbd: [], econ: [], fed: [] } }}
          weekDates={weekDates} todayIso={TODAY} onSelect={vi.fn()} />
      </MemoryRouter>
    )
    // Decluttered: no "star names to build your brief" band — the component
    // collapses to null so it never adds dead chrome atop the feed.
    expect(container.firstChild).toBeNull()
    expect(screen.queryByText(/Star names or connect your broker/)).toBeNull()
  })
})
