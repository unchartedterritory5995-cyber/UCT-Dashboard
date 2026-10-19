// The day page's save hook (2026-10-17 hotfix): it must send every field it is given, and it must update
// the cache entry the page actually reads, whose key carries the account and basis query.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import useSWR, { SWRConfig } from 'swr'
import useJ2DayNotesMutation, { dayNotesBody, isDayDetailKey, DAY_NOTE_FIELDS } from './useJ2DayNotesMutation'

const DATE = '2026-10-16'
const PAGE_KEY = `/api/j2/calendar/day/${DATE}?account_id=a1&basis=closed`
const SIX = {
  notes: 'general', prepNotes: 'watch NVDA 132', midDayNotes: 'held the plan', recapNotes: 'two good fills',
  attachments: [], rules: [{ id: 'r1', label: 'Wait', checked: true }],
}

afterEach(() => { vi.restoreAllMocks() })

function harness(fetchImpl) {
  vi.stubGlobal('fetch', fetchImpl)
  const wrapper = ({ children }) => (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
  )
  return renderHook(() => {
    const day = useSWR(PAGE_KEY, () => ({ date: DATE, trades: [], notes: { ...SIX, prepNotes: 'old prep' } }))
    return { day, m: useJ2DayNotesMutation(DATE) }
  }, { wrapper })
}

describe('useJ2DayNotesMutation', () => {
  it('sends all six fields it is given (the old hook dropped prep, mid-day and recap)', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ ...SIX, updatedAt: 'now' }) }))
    const { result } = harness(fetchImpl)
    await act(async () => { await result.current.m.save(SIX) })
    const [url, init] = fetchImpl.mock.calls.find(([, i]) => i?.method === 'PUT')
    expect(url).toBe(`/api/j2/calendar/day/${DATE}/notes`)
    const sent = JSON.parse(init.body)
    expect(Object.keys(sent).sort()).toEqual([...DAY_NOTE_FIELDS].sort())
    expect(sent.prepNotes).toBe('watch NVDA 132')
    expect(sent.midDayNotes).toBe('held the plan')
    expect(sent.recapNotes).toBe('two good fills')
  })

  it('updates the cache entry the page reads, whose key carries the query string', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ ...SIX, updatedAt: 'now' }) }))
    const { result } = harness(fetchImpl)
    await vi.waitFor(() => expect(result.current.day.data?.notes?.prepNotes).toBe('old prep'))
    await act(async () => { await result.current.m.save(SIX) })
    expect(result.current.day.data.notes.prepNotes).toBe('watch NVDA 132')
  })

  it('a failed save reports false and keeps the error', async () => {
    const fetchImpl = vi.fn(async (url, init) => (
      init?.method === 'PUT' ? { ok: false, status: 400, json: async () => ({ detail: 'bad' }) } : { ok: true, json: async () => ({}) }
    ))
    const { result } = harness(fetchImpl)
    let ok
    await act(async () => { ok = await result.current.m.save(SIX) })
    expect(ok).toBe(false)
    expect(result.current.m.error?.message).toBe('bad')
  })
})

describe('dayNotesBody / isDayDetailKey', () => {
  it('leaves out an undefined field so the server keeps it, and keeps an empty one', () => {
    expect(dayNotesBody({ notes: 'x', prepNotes: undefined, rules: [] })).toEqual({ notes: 'x', rules: [] })
    expect(dayNotesBody({ recapNotes: '' })).toEqual({ recapNotes: '' })
  })
  it('matches the bare path and its query variants for the same date only', () => {
    expect(isDayDetailKey(`/api/j2/calendar/day/${DATE}`, DATE)).toBe(true)
    expect(isDayDetailKey(PAGE_KEY, DATE)).toBe(true)
    expect(isDayDetailKey(`/api/j2/calendar/day/${DATE}/notes`, DATE)).toBe(false)
    expect(isDayDetailKey('/api/j2/calendar/day/2026-10-17?basis=closed', DATE)).toBe(false)
    expect(isDayDetailKey(null, DATE)).toBe(false)
  })
})
