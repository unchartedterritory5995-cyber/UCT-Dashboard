// app/src/pages/calendar/CalendarHeader.test.jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// Force desktop layout + stub the phone sheet so the import resolves cheaply.
vi.mock('../../hooks/useBreakpoint', () => ({ useIsPhone: () => false }))
vi.mock('../../components/mobile', () => ({ FiltersSheet: () => null }))

import CalendarHeader from './CalendarHeader'

const baseFilters = {
  audience: 'mine', minMcap: 0, sort: 'mine',
  minAvgVol: null, priceMin: null, priceMax: null,
}

function renderHeader(overrides = {}) {
  const props = {
    view: 'table', setView: vi.fn(),
    weekLabel: 'Week of Jun 9–13',
    filters: baseFilters, setFilters: vi.fn(),
    mySources: ['watchlist', 'flagged', 'positions', 'uct20'], setMySources: vi.fn(),
    monthCursor: { year: 2026, month: 6 }, setMonthCursor: vi.fn(),
    eventTypes: new Set(['earnings']), setEventTypes: vi.fn(),
    ...overrides,
  }
  return render(<MemoryRouter><CalendarHeader {...props} /></MemoryRouter>)
}

describe('CalendarHeader (consolidated)', () => {
  it('shows the Board | Table | Month view segment + audience chips inline', () => {
    renderHeader()
    expect(screen.getByText('Board')).toBeTruthy()
    expect(screen.getByText('Table')).toBeTruthy()
    expect(screen.getByText('Month')).toBeTruthy()
    expect(screen.getByText('Watchlist')).toBeTruthy()       // audience chip
  })

  it('view segment fires setView with the v3 values', () => {
    const setView = vi.fn()
    renderHeader({ setView })
    fireEvent.click(screen.getByText('Board'))
    expect(setView).toHaveBeenCalledWith('board')
  })

  it('hides secondary controls until the Filters panel is opened', () => {
    renderHeader()
    expect(screen.queryByText('Min avg vol')).toBeNull()
    expect(screen.queryByText('Count toward My Stocks')).toBeNull()
    fireEvent.click(screen.getByLabelText('Open calendar filters'))
    expect(screen.getByText('Min avg vol')).toBeTruthy()
    expect(screen.getByText('IPOs')).toBeTruthy()
    expect(screen.getByText('Count toward My Stocks')).toBeTruthy()
    expect(screen.getByText(/Download .ics/)).toBeTruthy()
  })

  it('no longer renders the standalone My Stocks gear or inline Export button', () => {
    renderHeader()
    expect(screen.queryByText('★ My Stocks ⚙')).toBeNull()
    expect(screen.queryByText('Export ▾')).toBeNull()
  })

  it('badges the Filters button with the active-filter count', () => {
    renderHeader({ filters: { ...baseFilters, minAvgVol: 500000 } })
    expect(screen.getByLabelText('Open calendar filters').textContent).toMatch(/· 1/)
  })
})

// ── WSE competitor pass: quick filters in the navigator row ─────────────────

describe('CalendarHeader — quick filters', () => {
  it('renders the four cap pills and writes minMcap on click', () => {
    const setFilters = vi.fn()
    renderHeader({ setFilters, setQuickQ: vi.fn() })
    const group = screen.getByRole('group', { name: 'Market cap filter' })
    expect(group.textContent).toContain('$1B+')
    expect(group.textContent).toContain('$100B+')
    fireEvent.click(screen.getByText('$10B+'))
    expect(setFilters).toHaveBeenCalledWith(expect.objectContaining({ minMcap: 10 }))
  })

  it('marks the active cap pill via aria-pressed', () => {
    renderHeader({ filters: { ...baseFilters, minMcap: 10 }, setQuickQ: vi.fn() })
    expect(screen.getByText('$10B+').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('$1B+').getAttribute('aria-pressed')).toBe('false')
  })

  it('the ONE search input live-filters (setQuickQ) and Escape clears it', () => {
    const setQuickQ = vi.fn()
    renderHeader({ setQuickQ, quickQ: '', onSearchJump: vi.fn() })
    const input = screen.getByLabelText("Filter this week or jump to a ticker's report date")
    fireEvent.change(input, { target: { value: 'nvd' } })
    expect(setQuickQ).toHaveBeenCalledWith('nvd')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(setQuickQ).toHaveBeenCalledWith('')
  })

  it('there is exactly ONE search input (the old quick-filter box is gone)', () => {
    renderHeader({ setQuickQ: vi.fn(), onSearchJump: vi.fn() })
    expect(screen.getAllByRole('textbox')).toHaveLength(1)
    expect(screen.queryByLabelText('Filter visible reporters by ticker or company name')).toBeNull()
  })

  it('shows summary counts with hidden + Clear when quick filters bite', () => {
    const onClearQuick = vi.fn()
    renderHeader({
      filters: { ...baseFilters, minMcap: 100 },
      setQuickQ: vi.fn(),
      onClearQuick,
      weekCounts: { raw: 120, total: 18, mine: 3, hidden: 102 },
    })
    expect(screen.getByText(/18 reporting/)).toBeTruthy()
    expect(screen.getByText(/102 hidden/)).toBeTruthy()
    fireEvent.click(screen.getByText('Clear'))
    expect(onClearQuick).toHaveBeenCalled()
  })

  it('the density toggle is fully retired', () => {
    renderHeader({ setQuickQ: vi.fn() })
    expect(screen.queryByText('Rows')).toBeNull()
    expect(screen.queryByText('Tiles')).toBeNull()
  })

  it('the ⚙ panel no longer carries the cap select (pills own minMcap)', () => {
    renderHeader({ setQuickQ: vi.fn() })
    fireEvent.click(screen.getByLabelText('Open calendar filters'))
    expect(screen.queryByText('Any cap')).toBeNull()
    expect(screen.getByText('Sort')).toBeTruthy()
  })

  it('hides the quick filters entirely in month view', () => {
    renderHeader({ view: 'month', setQuickQ: vi.fn() })
    expect(screen.queryByRole('group', { name: 'Market cap filter' })).toBeNull()
  })

  it('week chevrons + Today pill carry keyboard-hint tooltips', () => {
    renderHeader({ dayTabs: DAY_TABS, isCurrentWeek: false, onGotoToday: vi.fn(), onSearchJump: vi.fn() })
    expect(screen.getByLabelText('Previous week').getAttribute('title')).toBe('Previous week (←)')
    expect(screen.getByLabelText('Next week').getAttribute('title')).toBe('Next week (→)')
    expect(screen.getByText('Today').getAttribute('title')).toBe('Back to today (T)')
  })
})

// ── Flagship 1b: Week Navigator + ticker search ──────────────────────────────

const DAY_TABS = [
  { ds: '2026-07-13', label: 'Mon Jul 13', count: 4,  mineN: 0, is_today: false },
  { ds: '2026-07-14', label: 'Tue Jul 14', count: 9,  mineN: 2, is_today: false },
  { ds: '2026-07-15', label: 'Wed Jul 15', count: 21, mineN: 0, is_today: true },
  { ds: '2026-07-16', label: 'Thu Jul 16', count: 13, mineN: 1, is_today: false },
  { ds: '2026-07-17', label: 'Fri Jul 17', count: 2,  mineN: 0, is_today: false },
]

describe('CalendarHeader — Week Navigator', () => {
  it('renders five day tabs with reporter + mine counts', () => {
    renderHeader({ dayTabs: DAY_TABS, onDayTab: vi.fn(), onSearchJump: vi.fn() })
    const tab = screen.getByLabelText('Go to Wed Jul 15')
    expect(tab.textContent).toMatch(/WED 15/)
    expect(tab.textContent).toMatch(/21/)
    expect(screen.getByLabelText('Go to Tue Jul 14').textContent).toMatch(/2$/)
  })

  it('day tab click fires onDayTab with the date', () => {
    const onDayTab = vi.fn()
    renderHeader({ dayTabs: DAY_TABS, onDayTab, onSearchJump: vi.fn() })
    fireEvent.click(screen.getByLabelText('Go to Thu Jul 16'))
    expect(onDayTab).toHaveBeenCalledWith('2026-07-16')
  })

  it('week arrows page and the Today pill appears only off the current week', () => {
    const onPrev = vi.fn(); const onNext = vi.fn(); const onToday = vi.fn()
    const { rerender } = renderHeader({
      dayTabs: DAY_TABS, isCurrentWeek: true,
      onPrevWeek: onPrev, onNextWeek: onNext, onGotoToday: onToday, onSearchJump: vi.fn(),
    })
    fireEvent.click(screen.getByLabelText('Previous week'))
    fireEvent.click(screen.getByLabelText('Next week'))
    expect(onPrev).toHaveBeenCalled()
    expect(onNext).toHaveBeenCalled()
    expect(screen.queryByText('Today')).toBeNull()

    rerender(
      <MemoryRouter>
        <CalendarHeader
          view="feed" setView={vi.fn()} weekLabel="Week of Jul 13–17"
          filters={baseFilters} setFilters={vi.fn()}
          mySources={[]} setMySources={vi.fn()}
          monthCursor={{ year: 2026, month: 7 }} setMonthCursor={vi.fn()}
          eventTypes={new Set(['earnings'])} setEventTypes={vi.fn()}
          dayTabs={DAY_TABS} isCurrentWeek={false}
          onGotoToday={onToday} onSearchJump={vi.fn()}
        />
      </MemoryRouter>
    )
    fireEvent.click(screen.getByText('Today'))
    expect(onToday).toHaveBeenCalled()
  })

  it('week-label button opens the ±8-week picker with a this-week marker', () => {
    renderHeader({ dayTabs: DAY_TABS, onGotoWeek: vi.fn(), onSearchJump: vi.fn() })
    fireEvent.click(screen.getByLabelText('Pick a week'))
    expect(screen.getByText('this week')).toBeTruthy()
    expect(screen.getAllByText(/Week of /).length).toBeGreaterThan(10)
  })

  it('renders the ticker search and resolves a selection via next-report', async () => {
    const onJump = vi.fn()
    global.fetch = vi.fn(async (url) => {
      if (String(url).includes('/api/ticker-search')) {
        return { ok: true, json: async () => ({ results: [{ ticker: 'PEP', name: 'PepsiCo' }] }) }
      }
      if (String(url).includes('/api/calendar/next-report')) {
        return { ok: true, json: async () => ({ sym: 'PEP', date: '2026-07-16', timing: 'bmo' }) }
      }
      return { ok: false, json: async () => ({}) }
    })
    renderHeader({ dayTabs: DAY_TABS, onSearchJump: onJump })
    const input = screen.getByLabelText("Filter this week or jump to a ticker's report date")
    fireEvent.change(input, { target: { value: 'PEP' } })
    await new Promise(r => setTimeout(r, 250))          // typeahead debounce
    fireEvent.click(await screen.findByText('PepsiCo'))
    await new Promise(r => setTimeout(r, 0))
    expect(onJump).toHaveBeenCalledWith('PEP', '2026-07-16')
  })

  it('hides the navigator in month view (month nav owns time there)', () => {
    renderHeader({ view: 'month', dayTabs: DAY_TABS, onSearchJump: vi.fn() })
    expect(screen.queryByLabelText('Previous week')).toBeNull()
    expect(screen.getByLabelText('Previous month')).toBeTruthy()
  })
})
