// Lane R calendar depth, wired into the REAL page: each surface renders only when its
// server flag is on, and D-10's switch reaches the ONE tiering call — only while D-10
// is on. The page's data hooks are mocked; fetch answers the two depth routes.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { AuthContext } from '../../context/AuthContext'

const MON = '2026-11-02'
const PAYLOAD = {
  week_start: MON,
  week_end: '2026-11-06',
  days: { [MON]: { label: 'Mon', bmo: [{ sym: 'AAA', mc_b: 50 }], amc: [{ sym: 'BBB', mc_b: 5 }], tbd: [] } },
}
const BUCKETS = [{ sources: ['watchlist', 'flagged'], weight: 2 }, { sources: ['positions'], weight: 3 }]
const MY_SETS = { watchlist: ['BBB'], flagged: [], positions: [], uct20: [], weight_buckets: BUCKETS }

vi.mock('./useCalendarData', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    useCalendar: () => ({ data: PAYLOAD, error: null, mutate: vi.fn() }),
    useCalendarMySets: () => ({ data: MY_SETS }),
    useWeekEnrichment: () => ({ data: undefined }),
    useWeekMetrics: () => ({ data: undefined }),
    useIpos: () => ({ data: undefined }),
    useDividends: () => ({ data: undefined }),
  }
})

vi.mock('./importance', async (importOriginal) => {
  const real = await importOriginal()
  return { ...real, tierWeek: vi.fn(real.tierWeek) }
})

import Calendar from '../Calendar'
import { tierWeek } from './importance'

const STATUS = {
  symbols: { AAA: { report_date: MON, status: 'confirmed', basis: 'session=bmo', status_at: '2026-10-30T14:00:00+00:00', first_confirmed_at: '2026-10-30T14:00:00+00:00', moved: null } },
  unknown: ['BBB'],
  states: {},
  company_signaled: { state: 'unavailable', reason: 'No provider returns it.' },
  timestamps_are: "when UCT's calendar build first saw each fact (UTC), not the company's own announcement time",
}
const INDEX = {
  events: [{ date: '2026-12-18', kind: 'index_rebalance', index: 'S&P 500', event: 'Quarterly rebalance', status: 'rule_derived', announced: false, rule: 'third Friday', notice: 'n', citation: 'c', calendar_check: 'trading_day', calendar_note: null }],
  not_covered: [{ index: 'Russell US indexes', reason: 'a dated source is needed.' }],
}

let calls = []
beforeEach(() => {
  calls = []
  tierWeek.mockClear()
  try { window.localStorage.clear() } catch { /* ignore */ }
  globalThis.fetch = vi.fn((url) => {
    calls.push(String(url))
    const body = String(url).startsWith('/api/calendar/date-status') ? STATUS
      : String(url).startsWith('/api/calendar/index-events') ? INDEX : {}
    return Promise.resolve({ ok: true, status: 200, json: async () => body })
  })
})

function renderPage(calendarDepth) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <AuthContext.Provider value={{ calendarDepth }}>
        <MemoryRouter initialEntries={['/calendar']}>
          <Routes><Route path="/calendar" element={<Calendar />} /></Routes>
        </MemoryRouter>
      </AuthContext.Provider>
    </SWRConfig>,
  )
}

const ALL_OFF = { earnings_date_status_enabled: false, index_rebalance_events_enabled: false, calendar_order_explain_enabled: false }
const ALL_ON = { earnings_date_status_enabled: true, index_rebalance_events_enabled: true, calendar_order_explain_enabled: true }
const lastBuckets = () => tierWeek.mock.calls[tierWeek.mock.calls.length - 1][2]

describe('calendar depth on the page', () => {
  it('dark: no surface renders and neither depth route is ever requested', async () => {
    renderPage(ALL_OFF)
    await screen.findByText(/Week of Nov 2/)
    expect(screen.queryByTestId('date-status-strip')).toBeNull()
    expect(screen.queryByTestId('index-events-band')).toBeNull()
    expect(screen.queryByTestId('order-explain')).toBeNull()
    expect(calls.some(u => u.includes('date-status') || u.includes('index-events'))).toBe(false)
  })

  it('armed: the date-status strip asks for exactly this week\'s reporters and names its states', async () => {
    renderPage(ALL_ON)
    await waitFor(() => expect(calls.some(u => u.startsWith('/api/calendar/date-status'))).toBe(true))
    const url = calls.find(u => u.startsWith('/api/calendar/date-status'))
    expect(decodeURIComponent(url.split('syms=')[1])).toBe('AAA,BBB')
    expect(await screen.findByTestId('date-status-count-confirmed')).toHaveTextContent('1 confirmed')
    expect(screen.getByTestId('date-status-company-signaled')).toHaveTextContent('No provider returns it.')
  })

  it('armed: the index band says rule-derived in words and names what it does not cover', async () => {
    renderPage(ALL_ON)
    expect(await screen.findByTestId('index-events-next')).toHaveTextContent('not an announced date')
    expect(screen.getByTestId('index-events-not-covered')).toHaveTextContent('Russell US indexes')
    expect(calls.find(u => u.startsWith('/api/calendar/index-events'))).toContain(`start=${MON}`)
  })

  it('D-10: the switch removes the personal boost from the ONE tiering call, and puts it back', async () => {
    renderPage(ALL_ON)
    await screen.findByTestId('order-explain')
    expect(lastBuckets()).toBe(BUCKETS)
    expect(screen.getByTestId('order-explain-boosted-row')).toHaveTextContent('BBB +2: a watchlist +2')
    fireEvent.click(screen.getByTestId('order-explain-toggle'))
    await waitFor(() => expect(lastBuckets()).toEqual([]))
    expect(screen.getByTestId('order-explain-state')).toHaveTextContent('Personal boost is off')
    fireEvent.click(screen.getByTestId('order-explain-toggle'))
    await waitFor(() => expect(lastBuckets()).toBe(BUCKETS))
  })

  it('D-10 dark: a stored "boost off" from an earlier session changes nothing', async () => {
    window.localStorage.setItem('calendar.orderBoostOff', '1')
    renderPage({ ...ALL_ON, calendar_order_explain_enabled: false })
    await screen.findByText(/Week of Nov 2/)
    expect(lastBuckets()).toBe(BUCKETS)
  })
})
