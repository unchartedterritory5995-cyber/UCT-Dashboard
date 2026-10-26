// The tracker block's subscription life and its day across ET midnight (wave 9, Task 9.14; the routine block's
// I-1, N-5 and M-7 cases, for the tracker). toolsApi is the REAL module; only `subscribe` is wrapped, to count live
// subscriptions.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react'

const live = { n: 0, opened: 0, closed: 0 }
vi.mock('../../../lib/blocks/toolsApi', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    subscribe: (...args) => {
      const off = real.subscribe(...args)
      live.n += 1; live.opened += 1
      let done = false
      return () => { if (!done) { done = true; live.n -= 1; live.closed += 1 } off() }
    },
  }
})
const { default: TrackerBlock } = await import('./TrackerBlock')

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
/** The server's summary over the recent entries (trackers._summary): the readable values' average, the newest entry
 *  when it has a value, and the count (never 0). The fake computes what the real server sends. */
const summary = (recent) => {
  const vals = recent.map((r) => r.value).filter((v) => typeof v === 'number' && Number.isFinite(v))
  const last = recent[recent.length - 1]
  return { average: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null,
    latest: last && typeof last.value === 'number' ? { ...last } : null, n: recent.length || null }
}
function serve(st) {
  const calls = []
  const dayOf = (d) => ({ day: d, value: st.values[d] ?? null, text: st.values[d] == null ? null : String(st.values[d]), writable: true })
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const method = init.method || 'GET'
    calls.push({ url, method, body: init.body ? JSON.parse(init.body) : null })
    if (url === '/api/j2/trackers/days') {
      const { ids, days } = JSON.parse(init.body)
      const out = { trackers: {} }
      if (days.includes('today')) out.resolved = { today: st.today }
      for (const id of ids) {
        const recent = Object.keys(st.values).sort().map((d) => ({ day: d, value: st.values[d] }))
        out.trackers[id] = { tracker: { id, name: 'Mood', kind: 'scale', unit: null, archived: false, readOnly: false, settings: { days: 'any' } },
          days: Object.fromEntries(days.map((d) => { const r = d === 'today' ? st.today : d; return [r, dayOf(r)] })),
          recent, ...summary(recent) }
      }
      return json(200, out)
    }
    const m = /^\/api\/j2\/trackers\/t1\/days\/([^/]+)$/.exec(url)
    if (m && method === 'PUT') {
      if (st.failLogs > 0) { st.failLogs -= 1; return json(500, {}) }
      const { value } = JSON.parse(init.body)
      if (value === null) delete st.values[m[1]]
      else st.values[m[1]] = value
      return json(200, dayOf(m[1]))
    }
    return json(404, {})
  })
  return calls
}
const editor = { storage: { uctJournalWidgets: { noteDay: '2026-10-26' } } }
const pressed = (name) => screen.getByRole('button', { name }).getAttribute('aria-pressed')

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })

describe('one subscription per block, gone on unmount and on a day change', () => {
  it('mount -> 1; a params change moves it (one closed, one opened, still 1); unmount -> 0', async () => {
    serve({ today: '2026-10-27', values: {} })
    live.n = 0; live.opened = 0; live.closed = 0
    const { rerender, unmount } = render(<TrackerBlock params={{ trackerId: 't1', day: '2026-10-26', bind: 'note-day' }} setParams={vi.fn()} editable editor={editor} />)
    await waitFor(() => expect(screen.getAllByRole('button', { name: /^[1-5]$/ })).toHaveLength(5))
    expect(live.n).toBe(1)
    const opened = live.opened
    rerender(<TrackerBlock params={{ trackerId: 't1', day: '2026-10-27', bind: 'note-day' }} setParams={vi.fn()} editable editor={editor} />)
    await waitFor(() => expect(screen.getByText('For Tue Oct 27')).toBeTruthy())
    expect(live.n).toBe(1)
    expect(live.opened - opened).toBe(1)
    expect(live.closed).toBe(1)
    unmount()
    expect(live.n).toBe(0)
  })
})

describe('a follow-today block across ET midnight', () => {
  it("after midnight the day line, the value and the next log's day are all the new day", async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    vi.setSystemTime(new Date('2026-10-27T03:58:00Z'))          // 23:58 ET on Mon Oct 26
    const st = { today: '2026-10-26', values: { '2026-10-26': 2, '2026-10-27': 4 } }
    const calls = serve(st)
    render(<TrackerBlock params={{ trackerId: 't1', day: '', bind: 'today' }} setParams={vi.fn()} editable editor={editor} />)
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })
    expect(screen.getByText('For Mon Oct 26')).toBeTruthy()
    expect(pressed('2')).toBe('true')
    st.today = '2026-10-27'                                      // the server's day moves at ET midnight
    await act(async () => { await vi.advanceTimersByTimeAsync(3 * 60 * 1000) })
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })
    expect(screen.getByText('For Tue Oct 27')).toBeTruthy()
    expect(pressed('2')).toBe('false')
    expect(pressed('4')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: '5' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })
    expect(calls.filter((c) => c.method === 'PUT').map((c) => [c.url, c.body])).toEqual([['/api/j2/trackers/t1/days/2026-10-27', { value: 5 }]])
  })

  it('a Retry pending at 23:59 never logs to yesterday: midnight clears it, and the next log is the new day\'s', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    vi.setSystemTime(new Date('2026-10-27T03:59:00Z'))          // 23:59 ET on Mon Oct 26
    const st = { today: '2026-10-27', values: {}, failLogs: 1 }
    const calls = serve(st)
    render(<TrackerBlock params={{ trackerId: 't1', day: '', bind: 'today' }} setParams={vi.fn()} editable editor={editor} />)
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })
    fireEvent.click(screen.getByRole('button', { name: '3' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
    st.today = '2026-10-28'
    await act(async () => { await vi.advanceTimersByTimeAsync(2 * 60 * 1000) })
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })
    expect(screen.getByText('For Wed Oct 28')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()       // the old day's Retry is gone
    fireEvent.click(screen.getByRole('button', { name: '3' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })
    const puts = calls.filter((c) => c.method === 'PUT').map((c) => c.url)
    expect(puts).toEqual(['/api/j2/trackers/t1/days/2026-10-27', '/api/j2/trackers/t1/days/2026-10-28'])
    expect(st.values['2026-10-27']).toBeUndefined()                         // nothing ever landed on yesterday
  })
})
