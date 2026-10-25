// The routine block's subscription life and its day across ET midnight (wave 9, Task 9.13 fix round 1: I-1, M-7).
// toolsApi is the REAL module; only `subscribe` is wrapped, to count live subscriptions.
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
const { default: RoutineBlock } = await import('./RoutineBlock')

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
const ITEMS = [{ id: 'i1', text: 'Read the morning wire', negative: false }, { id: 'i2', text: 'Mark key levels', negative: false }]
function serve(st) {
  const calls = []
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const method = init.method || 'GET'
    calls.push({ url, method, body: init.body ? JSON.parse(init.body) : null })
    const entry = (day) => {
      const ticked = Object.fromEntries(ITEMS.map((it) => [it.id, (st.ticks[day] || {})[it.id] === true]))
      return { day, state: 'open', ticked, skipped: false, items: ITEMS, writable: true, consistency: null, run: {}, suggested: [] }
    }
    if (url === '/api/j2/routines/days') {
      const { ids, days } = JSON.parse(init.body)
      const out = { routines: {} }
      if (days.includes('today')) out.resolved = { today: st.today }
      for (const id of ids) {
        out.routines[id] = { routine: { id, name: 'Pre-market routine', archived: false },
          days: Object.fromEntries(days.map((d) => { const r = d === 'today' ? st.today : d; return [r, entry(r)] })) }
      }
      return json(200, out)
    }
    const m = /^\/api\/j2\/routines\/r1\/days\/([^/]+)\/items\/([^/]+)$/.exec(url)
    if (m && method === 'PUT') {
      st.ticks[m[1]] = { ...(st.ticks[m[1]] || {}), [m[2]]: JSON.parse(init.body).ticked }
      return json(200, entry(m[1]))
    }
    return json(404, {})
  })
  return calls
}
const editor = { storage: { uctJournalWidgets: { noteDay: '2026-10-26' } } }

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })

describe('M-7: one subscription per block, gone on unmount and on a day change', () => {
  it('mount -> 1; a params change moves it (one closed, one opened, still 1); unmount -> 0', async () => {
    serve({ today: '2026-10-27', ticks: {} })
    live.n = 0; live.opened = 0; live.closed = 0
    const { rerender, unmount } = render(<RoutineBlock params={{ routineId: 'r1', day: '2026-10-26', bind: 'note-day' }} setParams={vi.fn()} editable editor={editor} />)
    await waitFor(() => expect(screen.getAllByRole('checkbox')).toHaveLength(2))
    expect(live.n).toBe(1)
    const opened = live.opened
    rerender(<RoutineBlock params={{ routineId: 'r1', day: '2026-10-27', bind: 'note-day' }} setParams={vi.fn()} editable editor={editor} />)
    await waitFor(() => expect(screen.getByText('For Tue Oct 27')).toBeTruthy())
    expect(live.n).toBe(1)
    expect(live.opened - opened).toBe(1)
    expect(live.closed).toBe(1)
    unmount()
    expect(live.n).toBe(0)
  })
})

describe('I-1: a follow-today block across ET midnight', () => {
  it('after midnight the day line, the ticks and the next tick\'s day are all the new day', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    vi.setSystemTime(new Date('2026-10-27T03:58:00Z'))          // 23:58 ET on Mon Oct 26
    const st = { today: '2026-10-26', ticks: { '2026-10-26': { i1: true }, '2026-10-27': { i2: true } } }
    const calls = serve(st)
    render(<RoutineBlock params={{ routineId: 'r1', day: '', bind: 'today' }} setParams={vi.fn()} editable editor={editor} />)
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })
    expect(screen.getByText('For Mon Oct 26')).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: 'Read the morning wire' }).getAttribute('aria-checked')).toBe('true')
    st.today = '2026-10-27'                                      // the server's day moves at ET midnight
    await act(async () => { await vi.advanceTimersByTimeAsync(3 * 60 * 1000) })
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })
    expect(screen.getByText('For Tue Oct 27')).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: 'Read the morning wire' }).getAttribute('aria-checked')).toBe('false')
    expect(screen.getByRole('checkbox', { name: 'Mark key levels' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Read the morning wire' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })
    expect(calls.filter((c) => c.method === 'PUT').map((c) => c.url)).toEqual(['/api/j2/routines/r1/days/2026-10-27/items/i1'])
  })
})
