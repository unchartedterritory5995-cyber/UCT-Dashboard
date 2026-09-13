// app/src/pages/BreadthCharts.loadError.test.jsx
//
// A-01 (P0): a failed history load must say what failed, and must never read as
// a quiet market. Asserted by rendered text.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { SWRConfig } from 'swr'
import BreadthCharts from './BreadthCharts'
import { todayET, shiftISO } from './breadth/sessionDates'

vi.mock('echarts-for-react', () => ({ default: () => <div data-testid="echart" /> }))

const ROWS = Array.from({ length: 10 }, (_, i) => ({
  date: shiftISO(todayET(), i - 9), breadth_score: 50 + i, pct_above_50sma: 40 + i,
}))

const answer = (status, body) => Promise.resolve({
  ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body),
})

function stub(history) {
  const calls = { history: 0 }
  vi.stubGlobal('fetch', vi.fn((url, opts) => {
    const u = String(url)
    if (u.includes('/api/breadth-monitor/live')) return answer(200, { ok: false })
    if (u.includes('/api/breadth-monitor')) { calls.history += 1; return history(calls.history) }
    if (u.includes('/api/auth/preferences')) return answer(200, opts?.method === 'POST' ? { ok: true } : {})
    return answer(200, {})
  }))
  return calls
}

// A fresh cache per render, so one test's error is never another's data, and the
// app's own focus policy (App.jsx SWR_CONFIG) so a focus event is not a fetch.
const renderTab = (swr = {}) => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false, ...swr }}>
    <BreadthCharts />
  </SWRConfig>,
)

describe('a failed history load never reads as an empty market', () => {
  it.each([
    [401, 'Your session has ended.', 'Sign in again to load breadth history.', 'Sign in'],
    [402, 'Data Charts is part of the UCT plan.', 'Choose a plan to chart breadth history.', 'See plans'],
    [500, "Breadth history didn't load.", 'The server returned an error.', 'Retry'],
  ])('a %i says what failed and what to do', async (status, title, body, action) => {
    stub(() => answer(status, { detail: 'refused' }))
    renderTab()
    expect(await screen.findByText(title)).toBeInTheDocument()
    expect(screen.getByText(body)).toBeInTheDocument()
    expect(screen.getByText(action)).toBeInTheDocument()
    expect(screen.queryByText('No data in selected range.')).not.toBeInTheDocument()
  })

  it('offers a retry for a network failure that really fetches again', async () => {
    const calls = stub(n => (n === 1 ? Promise.reject(new TypeError('Failed to fetch')) : answer(200, { rows: ROWS })))
    renderTab()
    expect(await screen.findByText('Check your connection, then retry.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('echart')).toBeInTheDocument()
    expect(calls.history).toBe(2)
  })

  it('does not ask again after the session has ended', async () => {
    const calls = stub(() => answer(401, { detail: 'refused' }))
    renderTab({ errorRetryInterval: 10 })
    await screen.findByText('Your session has ended.')
    await new Promise(r => setTimeout(r, 250))
    expect(calls.history).toBe(1)
  })

  // CONTROL: with the same fast retry interval a server error IS retried — so the
  // test above counts a retry that would have happened, not one that could not.
  it('does retry a server error under the same interval', async () => {
    const calls = stub(() => answer(500, { detail: 'boom' }))
    renderTab({ errorRetryInterval: 10 })
    await screen.findByText("Breadth history didn't load.")
    await waitFor(() => expect(calls.history).toBeGreaterThanOrEqual(2))
  })

  // CONTROL: "No data" still exists for a genuinely empty answer — the rail above
  // is not passing because the empty state was deleted.
  it('still says there is no data when the answer is empty', async () => {
    stub(() => answer(200, { rows: [] }))
    renderTab()
    expect(await screen.findByText('No data in selected range.')).toBeInTheDocument()
  })

  it('counts sessions, not days (A-15)', async () => {
    stub(() => answer(200, { rows: ROWS }))
    renderTab()
    expect(await screen.findByText('10 sessions')).toBeInTheDocument()
  })
})
