// Completeness audit 2026-10-07, ERROR/RETRY gap 7 (BRD): the Monitor grid swallowed its errors.
// A failed /dates read left the header on "Loading…" forever; a failed row block was caught and
// dropped, its rows skeletons that never filled. Both are now reported (datesFailed /
// blocksFailed) and `retry` asks again; Breadth.jsx draws them as an error block with a Retry.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { SWRConfig } from 'swr'
import useMonitorGrid from './useMonitorGrid'

const DATES = { dates: ['2026-10-06', '2026-10-05', '2026-10-02'], min: '2026-10-02', max: '2026-10-06' }
const ROWS = { rows: DATES.dates.map((date) => ({ date, breadth_score: 50 })) }
const ok = (body) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
const fail = () => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ detail: 'boom' }) })

const wrapper = ({ children }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>{children}</SWRConfig>
)

beforeEach(() => { try { localStorage.clear() } catch { /* jsdom */ } })
afterEach(() => vi.unstubAllGlobals())

describe('useMonitorGrid failures are reported, with a retry', () => {
  it('a failed timeline read is datesFailed, and retry recovers it', async () => {
    let datesOk = false
    vi.stubGlobal('fetch', vi.fn((u) => (String(u).includes('/dates') ? (datesOk ? ok(DATES) : fail()) : ok(ROWS))))
    const { result } = renderHook(() => useMonitorGrid({ enabled: true, liveRow: null }), { wrapper })
    await waitFor(() => expect(result.current.datesFailed).toBe(true))
    expect(result.current.ready).toBe(false)
    datesOk = true
    act(() => { result.current.retry() })
    await waitFor(() => expect(result.current.count).toBe(3))
    expect(result.current.datesFailed).toBe(false)
  })

  it('a failed row block is counted, never cached as rows, and retry fills it', async () => {
    let blockOk = false
    vi.stubGlobal('fetch', vi.fn((u) => (String(u).includes('/dates') ? ok(DATES) : (blockOk ? ok(ROWS) : fail()))))
    const { result } = renderHook(() => useMonitorGrid({ enabled: true, liveRow: null }), { wrapper })
    await waitFor(() => expect(result.current.count).toBe(3))
    act(() => { result.current.ensureRange(0, 2) })
    await waitFor(() => expect(result.current.blocksFailed).toBe(1))
    expect(result.current.getRow(0)).toBeNull()
    blockOk = true
    act(() => { result.current.retry() })
    await waitFor(() => expect(result.current.blocksFailed).toBe(0))
    await waitFor(() => expect(result.current.getRow(0)?.breadth_score).toBe(50))
  })
})
