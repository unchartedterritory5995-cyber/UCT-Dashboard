// @vitest-environment jsdom
// S5 CP4 — the dedicated-store path, exercised with TRACINGS_STORE_ENABLED
// mocked true (it defaults false in production; see tracingsStoreFlag.test.js
// for that pin). fetch is mocked; drawingsStore drives real local state.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import * as drawingsStore from './drawingsStore'

vi.mock('./tracingsStoreFlag', () => ({ TRACINGS_STORE_ENABLED: true }))

const hz = (price) => ({ type: 'horizontal', points: [{ price }] })
const blob = (price) => ({
  v: 1,
  tracings: [{ id: 'srv', name: 'Server', color: '#ffffff', order: 0 }],
  activeId: 'srv',
  visibleIds: ['srv'],
  byTracing: { srv: { NVDA: [{ id: 'd', ...hz(price) }] } },
})

const { default: useTracingsSync } = await import('./useTracingsSync')

let fetchMock

beforeEach(() => {
  localStorage.clear()
  drawingsStore._reset()
  vi.useFakeTimers()
  fetchMock = vi.fn()
  // ⛔ A DEFAULT FALLBACK, not just queued `...Once` responses — React
  // Testing Library's automatic unmount between tests can trigger this
  // hook's own unmount-flush cleanup (mirrors the preferences path's
  // "flush a pending push on unmount"), which calls fetch an EXTRA time
  // beyond what any one test explicitly queues. Without a default, that
  // extra call resolves `undefined` and throws reading `.status` on it —
  // an unhandled rejection that would silently pass every test regardless
  // (`lesson_a_swallowed_error_becomes_a_confident_finding`'s cousin: an
  // uncaught rejection nobody asserts on).
  fetchMock.mockResolvedValue(jsonResponse(200, { doc: null, revision: null, updatedAt: null }))
  global.fetch = fetchMock
})

function jsonResponse(status, body) {
  return { status, ok: status >= 200 && status < 300, json: async () => body }
}

describe('useTracingsSync — via the dedicated store (CP4, flag mocked true)', () => {
  it('hydrate: no server document, local content -> pushes with expectedRevision null', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { doc: null, revision: null, updatedAt: null }))
    drawingsStore.importTracings(blob(10))
    renderHook(() => useTracingsSync())
    await act(async () => { await Promise.resolve() })
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { doc: JSON.stringify(blob(10)), revision: 1, updatedAt: 'x' }))
    await act(async () => { vi.advanceTimersByTime(1500); await Promise.resolve(); await Promise.resolve() })
    const putCall = fetchMock.mock.calls.find(c => c[1]?.method === 'PUT')
    expect(putCall).toBeTruthy()
    const body = JSON.parse(putCall[1].body)
    expect(body.expectedRevision).toBeNull()
  })

  it('hydrate: server has content we lack -> adopts it', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { doc: JSON.stringify(blob(42)), revision: 3, updatedAt: 'x' }))
    renderHook(() => useTracingsSync())
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(drawingsStore.hasLocalTracingContent()).toBe(true)
    expect(localStorage.getItem('uct-tracings-sync-rev')).toBe('3')
  })

  it('a correct baseline push advances the local revision', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { doc: null, revision: null, updatedAt: null }))
    drawingsStore.importTracings(blob(10))
    renderHook(() => useTracingsSync())
    await act(async () => { await Promise.resolve() })
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { doc: JSON.stringify(blob(10)), revision: 1, updatedAt: 'x' }))
    await act(async () => { vi.advanceTimersByTime(1500); await Promise.resolve(); await Promise.resolve() })
    expect(localStorage.getItem('uct-tracings-sync-rev')).toBe('1')
  })

  it('⛔ A-5 FORK ON 409: adopts the servers copy rather than clobbering it', async () => {
    // No server doc at hydrate -> pushes with expectedRevision null -> server refuses 409
    // (someone else already wrote) -> re-fetches and adopts.
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { doc: null, revision: null, updatedAt: null }))
    drawingsStore.importTracings(blob(10))
    renderHook(() => useTracingsSync())
    await act(async () => { await Promise.resolve() })

    fetchMock.mockResolvedValueOnce(jsonResponse(409, {}))
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { doc: JSON.stringify(blob(999)), revision: 7, updatedAt: 'x' }))
    await act(async () => { vi.advanceTimersByTime(1500); await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })

    expect(localStorage.getItem('uct-tracings-sync-rev')).toBe('7')
    const exported = drawingsStore.exportTracings()
    expect(exported.byTracing.srv.NVDA[0].points[0].price).toBe(999)
  })

  it('CONTROL: the fork rail can see a NON-conflict (no fork fires on a clean 200)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { doc: null, revision: null, updatedAt: null }))
    drawingsStore.importTracings(blob(10))
    renderHook(() => useTracingsSync())
    await act(async () => { await Promise.resolve() })
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { doc: JSON.stringify(blob(10)), revision: 1, updatedAt: 'x' }))
    await act(async () => { vi.advanceTimersByTime(1500); await Promise.resolve(); await Promise.resolve() })
    // Local content is unchanged (10, not force-overwritten by a fork path).
    const exported = drawingsStore.exportTracings()
    expect(exported.byTracing.srv.NVDA[0].points[0].price).toBe(10)
  })

  it('a failed network request marks dirty and does not advance the revision', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { doc: null, revision: null, updatedAt: null }))
    drawingsStore.importTracings(blob(10))
    renderHook(() => useTracingsSync())
    await act(async () => { await Promise.resolve() })
    fetchMock.mockRejectedValueOnce(new Error('offline'))
    await act(async () => { vi.advanceTimersByTime(1500); await Promise.resolve(); await Promise.resolve() })
    expect(localStorage.getItem('uct-tracings-sync-rev')).toBeNull()
  })
})
