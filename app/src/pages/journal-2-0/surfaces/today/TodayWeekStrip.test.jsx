/**
 * TodayWeekStrip (B3) — compact current-ISO-week strip.
 *
 * Verifies the two load-bearing behaviors:
 *   - it renders exactly 7 day cells (the current ISO week, Sun–Sat)
 *   - clicking a cell deep-links to the Journal day page
 *     (`/journal-2-0/calendar/${date}`) — the same route WeekView uses.
 *
 * The calendar feed + selected account are mocked so the test is about the
 * strip's structure + deep-link, not the aggregation fetch.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const { navigateSpy } = vi.hoisted(() => ({ navigateSpy: vi.fn() }))

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useNavigate: () => navigateSpy }
})

let calendar = { days: [], basis: 'closed' }
let account = { id: 'a1', name: 'Default', balanceSource: 'broker' }
let accountId = 'a1'

vi.mock('../../hooks/useJ2SelectedAccount', () => ({
  default: () => ({ accountId, account, accounts: [account], setAccount: vi.fn(), isLoading: false }),
}))
vi.mock('../../hooks/useJ2Calendar', () => ({
  default: () => calendar,
}))

import TodayWeekStrip from './TodayWeekStrip'

function renderStrip() {
  return render(
    <MemoryRouter>
      <TodayWeekStrip />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  navigateSpy.mockClear()
  calendar = { days: [], basis: 'closed' }
  account = { id: 'a1', name: 'Default', balanceSource: 'broker' }
  accountId = 'a1'
})

describe('TodayWeekStrip', () => {
  it('renders exactly 7 day cells for the current ISO week', () => {
    renderStrip()
    expect(screen.getAllByTestId('week-cell')).toHaveLength(7)
  })

  it('clicking a cell deep-links to that day page (/journal-2-0/calendar/${date})', () => {
    renderStrip()
    const cells = screen.getAllByTestId('week-cell')
    fireEvent.click(cells[0])
    expect(navigateSpy).toHaveBeenCalledTimes(1)
    const dest = navigateSpy.mock.calls[0][0]
    expect(dest).toMatch(/^\/journal-2-0\/calendar\/\d{4}-\d{2}-\d{2}$/)
  })

  it('every cell deep-links to a distinct valid day page', () => {
    renderStrip()
    const cells = screen.getAllByTestId('week-cell')
    cells.forEach((c) => fireEvent.click(c))
    const dests = navigateSpy.mock.calls.map((c) => c[0])
    expect(dests).toHaveLength(7)
    dests.forEach((d) => expect(d).toMatch(/^\/journal-2-0\/calendar\/\d{4}-\d{2}-\d{2}$/))
    // 7 distinct consecutive days
    expect(new Set(dests).size).toBe(7)
  })

  it('renders per-day P&L + trade count when the feed has a matching day', () => {
    // Seed a day for one of the rendered cells. The strip derives dates from the
    // current ISO week; read them back off the aria-labels to pick a real one.
    const { rerender } = renderStrip()
    // Grab the day number of the 3rd cell (a weekday) and build its date via the
    // aria-label is brittle; instead just assert that when EVERY day carries a
    // summary, each cell shows a P&L string.
    // Rebuild the feed with a summary for the exact dates the strip navigates to.
    const cells = screen.getAllByTestId('week-cell')
    cells.forEach((c) => fireEvent.click(c))
    const dates = navigateSpy.mock.calls.map((c) => c[0].split('/').pop())
    calendar = {
      basis: 'closed',
      days: dates.map((date, i) => ({
        date,
        pnlDollar: i === 2 ? 250 : 0,
        pnlPercent: 0,
        rSum: 0,
        tradeCount: i === 2 ? 3 : 0,
        winners: i === 2 ? 2 : 0,
        losers: i === 2 ? 1 : 0,
      })),
    }
    rerender(
      <MemoryRouter>
        <TodayWeekStrip />
      </MemoryRouter>,
    )
    expect(screen.getByText('+$250.00')).toBeInTheDocument()
    expect(screen.getByText('3 trades')).toBeInTheDocument()
  })
})
