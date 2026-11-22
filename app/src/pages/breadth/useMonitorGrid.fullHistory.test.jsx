// 2026-11-20 — a jump to 2012 / 2019 (the date box, a year pick) landed on skeleton rows and waited
// ~1-2 s for its blocks (production). The page now loads the whole timeline ONCE in idle time, so a
// jump paints from memory: no block request for rows already held. Synthetic values only.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { SWRConfig } from 'swr'
import useMonitorGrid, { FULL_HISTORY_DAYS } from './useMonitorGrid'

const DATES = { dates: ['2026-10-06', '2026-10-05', '2026-10-02', '2012-03-15'], min: '2012-03-15', max: '2026-10-06' }
const FULL = { rows: DATES.dates.map((date, i) => ({ date, breadth_score: 40 + i })) }
const ok = (body) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
const wrapper = ({ children }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>{children}</SWRConfig>
)

beforeEach(() => {
  try { localStorage.clear() } catch { /* jsdom */ }
  vi.stubGlobal('requestIdleCallback', (fn) => setTimeout(fn, 0))
  vi.stubGlobal('cancelIdleCallback', (id) => clearTimeout(id))
})
afterEach(() => vi.unstubAllGlobals())

describe('useMonitorGrid — the whole timeline, once, in idle time', () => {
  it('fills every row from one full-window read; a later jump asks for no block', async () => {
    const urls = []
    vi.stubGlobal('fetch', vi.fn((u) => {
      urls.push(String(u))
      if (String(u).includes('/dates')) return ok(DATES)
      if (String(u).includes(`days=${FULL_HISTORY_DAYS}`)) return ok(FULL)
      return ok({ rows: [] })
    }))
    const { result } = renderHook(() => useMonitorGrid({ enabled: true, liveRow: null }), { wrapper })
    await waitFor(() => expect(result.current.getRow(3)?.breadth_score).toBe(43))
    expect(urls.filter((u) => u.includes(`days=${FULL_HISTORY_DAYS}`))).toHaveLength(1)
    const before = urls.length
    act(() => { result.current.ensureRange(3, 3) })   // the jump to 2012
    await new Promise((r) => setTimeout(r, 150))      // past the settle debounce
    expect(urls.length, 'a held block is not asked again').toBe(before)
  })
})
