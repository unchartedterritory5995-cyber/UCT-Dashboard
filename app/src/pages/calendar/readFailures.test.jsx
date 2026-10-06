// app/src/pages/calendar/readFailures.test.jsx
//
// Terminal quality pass 2026-10-05, calendar half. Three reads used to collapse a FAILED read
// into the answer "nothing there", so a member saw a quiet session / an empty month / no IPO
// chips for a read we never made:
//   * the Wire view (`useWire`)       -> "No reporters scheduled"
//   * the Month view (`useMonthCalendar`) -> an empty grid + "No reporters this month."
//   * the IPO and dividend chips (`useIpos`, `useDividends`) -> the chips just vanished
// Each is driven here through the REAL hook with a routed `fetch`, and asserted by the words
// a member reads.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, renderHook, waitFor, fireEvent } from '@testing-library/react'
import { SWRConfig } from 'swr'

vi.mock('../../hooks/useMarketOpen', () => ({
  default: () => ({ isOpen: true, isPremarket: false, isExtended: false }),
}))

import { useWire } from './useWire'
import { useIpos, useDividends } from './useCalendarData'
import MonthView from './MonthView'
import EventChipNotice from './EventChipNotice'

const wrapper = ({ children }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
    {children}
  </SWRConfig>
)

const answer = (status, body, headers = {}) => Promise.resolve({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (k) => headers[k] ?? null },
  json: async () => body,
})

let routes = {}
beforeEach(() => {
  routes = {}
  globalThis.fetch = vi.fn((url) => {
    const u = String(url)
    for (const [prefix, fn] of Object.entries(routes)) if (u.startsWith(prefix)) return fn(u)
    return answer(200, {})
  })
})

describe('the Wire view read', () => {
  it('a 502 is an error, never a null that renders as "no reporters"', async () => {
    routes['/api/calendar/wire'] = () => answer(502, { detail: 'bad gateway' })
    const { result } = renderHook(() => useWire(), { wrapper })
    await waitFor(() => expect(result.current.error).toBeTruthy())
    expect(result.current.data).toBeUndefined()
  })
})

describe('the Month view read', () => {
  const renderMonth = () => render(
    <MonthView weeklyDays={{}} mySets={null} mySources={[]}
      monthCursor={{ year: 2026, month: 6 }} setMonthCursor={() => {}} onOpenDay={() => {}} />,
    { wrapper },
  )

  it('while the month is in flight it says it is loading, and claims no empty month', () => {
    routes['/api/calendar/month'] = () => new Promise(() => {})
    renderMonth()
    expect(screen.getByTestId('month-read')).toHaveTextContent('Loading June 2026 earnings…')
    expect(screen.queryByText('No reporters this month.')).not.toBeInTheDocument()
  })

  it('a failed month read says so with a Retry, and claims no empty month', async () => {
    let n = 0
    routes['/api/calendar/month'] = () => { n += 1; return answer(503, {}) }
    renderMonth()
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(
      "June 2026 earnings couldn't be read right now. Empty days below are a gap in what we could read, not days without reporters."))
    expect(screen.queryByText('No reporters this month.')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(n).toBe(2))
  })

  it('a month assembled from a failed week says the grid may be missing reporters', async () => {
    routes['/api/calendar/month'] = () => answer(200, { month: '2026-06', days: {}, degraded: true })
    renderMonth()
    await waitFor(() => expect(screen.getByTestId('month-read')).toHaveTextContent(
      "Some weeks of June 2026 couldn't be read from the earnings providers, so the grid may be missing reporters."))
  })

  it('a month that was read and is genuinely empty says nothing about a failure', async () => {
    routes['/api/calendar/month'] = () => answer(200, { month: '2026-06', days: {}, degraded: false })
    renderMonth()
    await waitFor(() => expect(screen.getByText('No reporters this month.')).toBeInTheDocument())
    expect(screen.queryByTestId('month-read')).not.toBeInTheDocument()
  })
})

describe('the IPO and dividend chip reads', () => {
  it('useIpos: a failed request reads "failed"; a server-labelled failed read reads "failed"; an honest empty reads "ok"', async () => {
    routes['/api/calendar/ipos'] = () => answer(500, {})
    const a = renderHook(() => useIpos('2026-06-01', '2026-06-05'), { wrapper })
    await waitFor(() => expect(a.result.current.readState).toBe('failed'))

    routes['/api/calendar/ipos'] = () => answer(200, [], { 'X-Calendar-Read': 'failed' })
    const b = renderHook(() => useIpos('2026-06-01', '2026-06-05'), { wrapper })
    await waitFor(() => expect(b.result.current.readState).toBe('failed'))
    expect(b.result.current.data).toEqual([])

    routes['/api/calendar/ipos'] = () => answer(200, [{ sym: 'ACME', date: '2026-06-02' }])
    const c = renderHook(() => useIpos('2026-06-01', '2026-06-05'), { wrapper })
    await waitFor(() => expect(c.result.current.readState).toBe('ok'))
    expect(c.result.current.data).toEqual([{ sym: 'ACME', date: '2026-06-02' }])
  })

  it('useDividends: a server-labelled partial read reads "partial" and still serves its rows', async () => {
    routes['/api/calendar/dividends'] = () => answer(200, [{ sym: 'KO', date: '2099-01-01' }],
      { 'X-Calendar-Read': 'partial' })
    const { result } = renderHook(() => useDividends('KO,AAPL'), { wrapper })
    await waitFor(() => expect(result.current.readState).toBe('partial'))
    expect(result.current.data).toEqual([{ sym: 'KO', date: '2099-01-01' }])
  })

  it('the notice above the feed says which chip could not be read, and is silent otherwise', () => {
    const { rerender } = render(<EventChipNotice ipos="failed" dividends="partial" />)
    expect(screen.getByRole('status')).toHaveTextContent(
      "IPO dates couldn't be read right now. That is not the same as no IPOs this week.")
    expect(screen.getByRole('status')).toHaveTextContent(
      "Some dividend and split dates couldn't be read. A few of your names may be missing their chip.")
    rerender(<EventChipNotice ipos="ok" dividends="loading" />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    rerender(<EventChipNotice ipos={null} dividends="failed" />)
    expect(screen.getByRole('status')).toHaveTextContent(
      "Dividend and split dates couldn't be read right now. That is not the same as none this week.")
  })
})
