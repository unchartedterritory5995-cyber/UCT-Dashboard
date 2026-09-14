// app/src/pages/BreadthCharts.refresh.test.jsx
//
// A-09: the history is fetched again when the close is recorded, and when a
// member returns to a tab whose newest session is overdue — never on a timer.
// A-35: the window's edge is the Eastern date and follows the calendar.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import { SWRConfig } from 'swr'
import BreadthCharts from './BreadthCharts'
import { todayET, shiftISO } from './breadth/sessionDates'

vi.mock('echarts-for-react', () => ({ default: () => <div data-testid="echart" /> }))

const live = vi.hoisted(() => ({ value: { row: null, clock: null, meta: null } }))
vi.mock('../hooks/useLiveBreadth', () => ({ useLiveBreadth: () => live.value }))

const daysAgo = n => shiftISO(todayET(), -n)
const answer = (status, body) => Promise.resolve({
  ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body),
})

function stub(respond) {
  const calls = { history: 0 }
  vi.stubGlobal('fetch', vi.fn((url, opts) => {
    const u = String(url)
    if (u.includes('/api/breadth-monitor')) { calls.history += 1; return respond(calls.history) }
    if (u.includes('/api/auth/preferences')) return answer(200, opts?.method === 'POST' ? { ok: true } : {})
    return answer(200, {})
  }))
  return calls
}

/** Mounts under one stable SWR config and returns a rerender that re-reads `live.value`. */
function mount() {
  const value = { provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }
  const tree = () => <SWRConfig value={value}><BreadthCharts /></SWRConfig>
  const utils = render(tree())
  return () => utils.rerender(tree())
}

function visibility(state) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
}
const returnToTab = () => act(() => {
  visibility('hidden'); document.dispatchEvent(new Event('visibilitychange'))
  visibility('visible'); document.dispatchEvent(new Event('visibilitychange'))
})
const settle = () => new Promise(r => setTimeout(r, 150))

const HISTORY = Array.from({ length: 5 }, (_, i) => ({ date: daysAgo(5 - i), breadth_score: 50 + i }))
const PROVISIONAL = { row: { date: daysAgo(0), breadth_score: 70, _live: true }, clock: '2:47 PM', meta: { ok: true, superseded: false } }

beforeEach(() => { live.value = { row: null, clock: null, meta: null }; visibility('visible') })

describe('when the close is recorded', () => {
  it('fetches the history once, when the provisional point is withdrawn as superseded', async () => {
    live.value = PROVISIONAL
    const calls = stub(() => answer(200, { rows: HISTORY }))
    const rerender = mount()
    await waitFor(() => expect(calls.history).toBe(1))

    live.value = { row: null, clock: null, meta: { ok: true, superseded: true } }
    rerender()
    await waitFor(() => expect(calls.history).toBe(2))
    rerender()
    await settle()
    expect(calls.history).toBe(2)
  })

  // CONTROL: after hours there never was a provisional point, so nothing was withdrawn.
  it('does not refetch when there never was a provisional point', async () => {
    live.value = { row: null, clock: null, meta: { ok: true, superseded: true } }
    const calls = stub(() => answer(200, { rows: HISTORY }))
    const rerender = mount()
    await waitFor(() => expect(calls.history).toBe(1))
    rerender(); rerender()
    await settle()
    expect(calls.history).toBe(1)
  })

  // CONTROL: a point withdrawn because the read degraded is not a recorded close.
  it('does not refetch when the provisional point is withdrawn for another reason', async () => {
    live.value = PROVISIONAL
    const calls = stub(() => answer(200, { rows: HISTORY }))
    const rerender = mount()
    await waitFor(() => expect(calls.history).toBe(1))
    live.value = { row: null, clock: null, meta: { ok: true, superseded: false, degraded: true } }
    rerender()
    await settle()
    expect(calls.history).toBe(1)
  })

  it('keeps the chart and says so when that refresh fails', async () => {
    live.value = PROVISIONAL
    stub(n => (n === 1 ? answer(200, { rows: HISTORY }) : answer(500, { detail: 'boom' })))
    const rerender = mount()
    expect(await screen.findByTestId('echart')).toBeInTheDocument()

    live.value = { row: null, clock: null, meta: { ok: true, superseded: true } }
    rerender()
    expect(await screen.findByText("Couldn't refresh breadth history.")).toBeInTheDocument()
    expect(screen.getByText('Showing the last loaded data.')).toBeInTheDocument()
    expect(screen.getByTestId('echart')).toBeInTheDocument()
    expect(screen.queryByText('No data in selected range.')).not.toBeInTheDocument()
  })
})

describe('when a member returns to the tab', () => {
  it('asks again when the newest stored session is overdue — once per ten minutes', async () => {
    const calls = stub(() => answer(200, { rows: [{ date: daysAgo(30), breadth_score: 50 }] }))
    mount()
    await waitFor(() => expect(calls.history).toBe(1))
    returnToTab()
    await waitFor(() => expect(calls.history).toBe(2))
    returnToTab()
    await settle()
    expect(calls.history).toBe(2)
  })

  // CONTROL: history that already reaches today is not asked for again.
  it('does not ask again when the history is current', async () => {
    const calls = stub(() => answer(200, { rows: [{ date: daysAgo(0), breadth_score: 50 }] }))
    mount()
    await waitFor(() => expect(calls.history).toBe(1))
    returnToTab()
    await settle()
    expect(calls.history).toBe(1)
  })
})

describe('the window follows the Eastern calendar (A-35)', () => {
  afterEach(() => { vi.useRealTimers() })

  it('ends on the Eastern date after 8 PM ET, not the UTC one', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-12T01:30:00Z'))          // Fri 9:30 PM ET, already Saturday in UTC
    stub(() => answer(200, { rows: [{ date: '2026-09-11', breadth_score: 50 }] }))
    mount()
    await waitFor(() => expect(screen.getByLabelText('To')).toHaveValue('2026-09-11'))
    expect(screen.getByLabelText('From')).toHaveValue('2026-06-13')
  })

  it('moves the edge to the new day when a tab left open is returned to', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-11T20:00:00Z'))          // Fri 4 PM ET
    stub(() => answer(200, { rows: [{ date: '2026-09-11', breadth_score: 50 }] }))
    mount()
    await waitFor(() => expect(screen.getByLabelText('To')).toHaveValue('2026-09-11'))
    vi.setSystemTime(new Date('2026-09-14T13:00:00Z'))          // Mon 9 AM ET
    returnToTab()
    await waitFor(() => expect(screen.getByLabelText('To')).toHaveValue('2026-09-14'))
  })
})
