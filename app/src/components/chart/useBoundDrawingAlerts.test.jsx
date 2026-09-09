// @vitest-environment jsdom
/* "Follow this line" — the sync, and the two ways it could do harm.
 *
 * The interesting assertions here are the NEGATIVE ones. A binding that writes
 * too eagerly is a PATCH storm off a chart nobody touched; a binding that
 * deletes too eagerly destroys the user's alerts on a cold page load. Both fail
 * silently and both are worse than no binding at all, so each has its own case.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import useBoundDrawingAlerts, { _resetBoundAlertSync } from './useBoundDrawingAlerts'

const wrapper = ({ children }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, refreshInterval: 0 }}>
    {children}
  </SWRConfig>
)

const LINE = { id: 'd1', type: 'horizontal', points: [{ price: 114.26 }] }
const boundAlert = (over = {}) => ({
  id: 'a1', sym: 'NVDA', is_active: 1, drawing_id: 'd1',
  alert_type: 'line', target_price: 114.26,
  anchor_t1: null, anchor_p1: null, anchor_t2: null, anchor_p2: null, ...over,
})

let calls
function mockFetch(alerts) {
  calls = []
  global.fetch = vi.fn((url, init) => {
    calls.push({ url: String(url), method: (init?.method || 'GET').toUpperCase(), body: init?.body })
    if (String(url).startsWith('/api/watchlist-alerts?') || String(url) === '/api/watchlist-alerts')
      return Promise.resolve({ ok: true, json: () => Promise.resolve(alerts) })
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) })
  })
}
const writes = () => calls.filter((c) => c.method === 'PATCH' || c.method === 'DELETE')

beforeEach(() => { _resetBoundAlertSync() })
afterEach(() => { vi.restoreAllMocks() })

const mount = (props) => renderHook(
  (p) => useBoundDrawingAlerts({ sym: 'NVDA', getBars: () => [], tf: 'D', etOffset: -14400, ...p }),
  { wrapper, initialProps: props },
)

describe('useBoundDrawingAlerts', () => {
  it('a page LOAD writes nothing — the server already agrees with the line', async () => {
    mockFetch([boundAlert()])
    const { result } = mount({ drawings: [LINE] })
    await waitFor(() => expect(result.current.length).toBe(1))
    await new Promise((r) => setTimeout(r, 20))
    expect(writes()).toEqual([])
  })

  it('MOVING the line re-points the alert', async () => {
    mockFetch([boundAlert()])
    const { rerender } = mount({ drawings: [LINE] })
    await waitFor(() => expect(calls.length).toBeGreaterThan(0))
    rerender({ drawings: [{ ...LINE, points: [{ price: 119.5 }] }] })
    await waitFor(() => expect(writes().length).toBe(1))
    const w = writes()[0]
    expect(w.method).toBe('PATCH')
    expect(w.url).toBe('/api/watchlist-alerts/bound/d1')
    expect(JSON.parse(w.body)).toMatchObject({ alert_type: 'line', target_price: 119.5 })
  })

  it('TWO charts on one symbol send ONE patch, not two', async () => {
    mockFetch([boundAlert()])
    const a = mount({ drawings: [LINE] })
    const b = mount({ drawings: [LINE] })
    await waitFor(() => expect(calls.length).toBeGreaterThan(0))
    const moved = [{ ...LINE, points: [{ price: 121 }] }]
    a.rerender({ drawings: moved })
    b.rerender({ drawings: moved })
    await waitFor(() => expect(writes().length).toBe(1))
    await new Promise((r) => setTimeout(r, 20))
    expect(writes().length).toBe(1)
  })

  it('⛔ a drawing this browser has NEVER SEEN is never deleted', async () => {
    // The cold-mount / other-browser case: the alert is bound to a drawing that
    // is not in this localStorage. Absence is not evidence of deletion.
    mockFetch([boundAlert({ drawing_id: 'made-elsewhere' })])
    // A different line keeps the hook armed, so this is not passing by dormancy.
    mount({ drawings: [{ id: 'other', type: 'horizontal', points: [{ price: 50 }] }] })
    await waitFor(() => expect(calls.length).toBeGreaterThan(0))
    await new Promise((r) => setTimeout(r, 20))
    expect(writes()).toEqual([])
  })

  it('deleting a line SEEN this session takes its alert with it', async () => {
    mockFetch([boundAlert()])
    const { rerender } = mount({ drawings: [LINE] })
    await waitFor(() => expect(calls.length).toBeGreaterThan(0))
    rerender({ drawings: [{ id: 'keep-armed', type: 'horizontal', points: [{ price: 50 }] }] })
    await waitFor(() => expect(writes().length).toBe(1))
    expect(writes()[0]).toMatchObject({ method: 'DELETE', url: '/api/watchlist-alerts/bound/d1' })
  })

  it('an alert bound on ANOTHER symbol is not this chart’s business', async () => {
    mockFetch([boundAlert({ sym: 'AMD', drawing_id: 'd-amd' })])
    mount({ drawings: [LINE] })
    await waitFor(() => expect(calls.length).toBeGreaterThan(0))
    await new Promise((r) => setTimeout(r, 20))
    expect(writes()).toEqual([])
  })

  it('a TRIGGERED alert is history — it is not re-pointed', async () => {
    mockFetch([boundAlert({ is_active: 0 })])
    const { rerender } = mount({ drawings: [LINE] })
    await waitFor(() => expect(calls.length).toBeGreaterThan(0))
    rerender({ drawings: [{ ...LINE, points: [{ price: 200 }] }] })
    await new Promise((r) => setTimeout(r, 20))
    expect(writes()).toEqual([])
  })

  it('⭐ DORMANT with no line-ish drawing — it does not even fetch the list', async () => {
    mockFetch([boundAlert()])
    mount({ drawings: [{ id: 'r1', type: 'rect', points: [{ price: 1 }, { price: 2 }] }] })
    await new Promise((r) => setTimeout(r, 30))
    expect(calls).toEqual([])
  })

  it('CONTROL — the dormancy case is real: add a line and it DOES fetch', async () => {
    mockFetch([boundAlert()])
    const { rerender } = mount({ drawings: [{ id: 'r1', type: 'rect', points: [{ price: 1 }, { price: 2 }] }] })
    await new Promise((r) => setTimeout(r, 30))
    expect(calls).toEqual([])
    rerender({ drawings: [LINE] })
    await waitFor(() => expect(calls.length).toBeGreaterThan(0))
    expect(calls[0].url).toBe('/api/watchlist-alerts')
  })
})
