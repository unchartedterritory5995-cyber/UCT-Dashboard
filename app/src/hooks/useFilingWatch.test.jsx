import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, cleanup, act } from '@testing-library/react'

// S7 filing-watch hook — Stage 4/5 owner authorization. "Is {sym} currently
// watched" for every creation surface (TickerPopup/TickerHubSheet/Research)
// and the Settings management panel all come from this ONE hook/cache key
// (Part F: reuse the existing owner-scoped predicate list, no new endpoint).

const H = vi.hoisted(() => ({ user: { id: 'u1' } }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: H.user }) }))

import useFilingWatch from './useFilingWatch'

function predicate(id, sym, { suspended = false, created_at = 100 } = {}) {
  return {
    id, type_id: 'document-arrival',
    entity_scope: { kind: 'entity', id: `ent_${sym}`, symbol: sym },
    created_at, updated_at: created_at,
    suspended_at: suspended ? created_at + 10 : null,
    last_seen_state: { accession: 'A0' },
  }
}

beforeEach(() => {
  H.user = { id: 'u1' }
  vi.restoreAllMocks()
})
afterEach(cleanup)

describe('useFilingWatch — state derivation', () => {
  it('reports NOT_WATCHING for a symbol with no predicate', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ predicates: [] }) }))
    const { result } = renderHook(() => useFilingWatch())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.watchState('NVDA')).toBe('NOT_WATCHING')
  })

  it('reports ACTIVE for an active predicate, case-insensitively', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ predicates: [predicate('p1', 'NVDA')] }) }))
    const { result } = renderHook(() => useFilingWatch())
    await waitFor(() => expect(result.current.watchState('nvda')).toBe('ACTIVE'))
  })

  it('reports SUSPENDED for a suspended predicate, and requests the full list (active_only=false)', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ predicates: [predicate('p1', 'NVDA', { suspended: true })] }) }))
    const { result } = renderHook(() => useFilingWatch())
    await waitFor(() => expect(result.current.watchState('NVDA')).toBe('SUSPENDED'))
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('active_only=false'))
  })

  it('requests nothing while signed out', async () => {
    H.user = null
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ predicates: [] }) }))
    renderHook(() => useFilingWatch())
    await act(() => new Promise(r => setTimeout(r, 20)))
    expect(global.fetch).not.toHaveBeenCalled()
  })
})

describe('useFilingWatch — create / reactivate (idempotent, never optimistic)', () => {
  it('POSTs the ticker, awaits confirmation, then reflects ACTIVE (not before)', async () => {
    let created = false
    global.fetch = vi.fn(async (url, opts) => {
      if (opts?.method === 'POST') {
        created = true
        return { ok: true, json: async () => ({ predicate_id: 'p1' }) }
      }
      return { ok: true, json: async () => ({ predicates: created ? [predicate('p1', 'NVDA')] : [] }) }
    })
    const { result } = renderHook(() => useFilingWatch())
    await waitFor(() => expect(result.current.watchState('NVDA')).toBe('NOT_WATCHING'))

    let createPromise
    act(() => { createPromise = result.current.createOrReactivate('NVDA') })
    // While in flight, never optimistic — must not already read ACTIVE.
    expect(result.current.watchState('NVDA')).not.toBe('ACTIVE')
    await act(async () => { expect(await createPromise).toBe(true) })

    await waitFor(() => expect(result.current.watchState('NVDA')).toBe('ACTIVE'))
    const postCall = global.fetch.mock.calls.find(([, o]) => o?.method === 'POST')
    expect(postCall[0]).toBe('/api/alerts/taxonomy/document-arrival')
    expect(JSON.parse(postCall[1].body)).toEqual({ ticker: 'NVDA' })
  })

  it('a duplicate/idempotent backend response (existing predicate id) still resolves as success', async () => {
    global.fetch = vi.fn(async (url, opts) => {
      if (opts?.method === 'POST') return { ok: true, json: async () => ({ predicate_id: 'p1' }) } // same id both times
      return { ok: true, json: async () => ({ predicates: [predicate('p1', 'NVDA')] }) }
    })
    const { result } = renderHook(() => useFilingWatch())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    let ok1, ok2
    await act(async () => { ok1 = await result.current.createOrReactivate('NVDA') })
    await act(async () => { ok2 = await result.current.createOrReactivate('NVDA') })
    expect(ok1).toBe(true)
    expect(ok2).toBe(true)
    expect(result.current.watchState('NVDA')).toBe('ACTIVE')
  })

  it('reactivating a suspended watch uses the SAME create call (backend handles reactivation)', async () => {
    let reactivated = false
    global.fetch = vi.fn(async (url, opts) => {
      if (opts?.method === 'POST') { reactivated = true; return { ok: true, json: async () => ({ predicate_id: 'p1' }) } }
      return { ok: true, json: async () => ({ predicates: [predicate('p1', 'NVDA', { suspended: !reactivated })] }) }
    })
    const { result } = renderHook(() => useFilingWatch())
    await waitFor(() => expect(result.current.watchState('NVDA')).toBe('SUSPENDED'))

    await act(async () => { await result.current.createOrReactivate('NVDA') })
    await waitFor(() => expect(result.current.watchState('NVDA')).toBe('ACTIVE'))
  })

  it('a failed create surfaces as ERROR, not a silent no-op or a fabricated ACTIVE', async () => {
    global.fetch = vi.fn(async (url, opts) => {
      if (opts?.method === 'POST') return { ok: false, status: 422, json: async () => ({ detail: 'bad ticker' }) }
      return { ok: true, json: async () => ({ predicates: [] }) }
    })
    const { result } = renderHook(() => useFilingWatch())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    let ok
    await act(async () => { ok = await result.current.createOrReactivate('ZZZZ') })
    expect(ok).toBe(false)
    expect(result.current.watchState('ZZZZ')).toBe('ERROR')
  })
})

describe('useFilingWatch — suspend', () => {
  it('DELETEs the predicate id and reflects SUSPENDED after confirmation', async () => {
    let suspended = false
    global.fetch = vi.fn(async (url, opts) => {
      if (opts?.method === 'DELETE') { suspended = true; return { ok: true, json: async () => ({ suspended: true }) } }
      return { ok: true, json: async () => ({ predicates: [predicate('p1', 'NVDA', { suspended })] }) }
    })
    const { result } = renderHook(() => useFilingWatch())
    await waitFor(() => expect(result.current.watchState('NVDA')).toBe('ACTIVE'))

    await act(async () => { expect(await result.current.suspend('p1', 'NVDA')).toBe(true) })
    await waitFor(() => expect(result.current.watchState('NVDA')).toBe('SUSPENDED'))
    const del = global.fetch.mock.calls.find(([, o]) => o?.method === 'DELETE')
    expect(del[0]).toBe('/api/alerts/taxonomy/document-arrival/p1')
  })
})

describe('useFilingWatch — ownership isolation (client never assumes cross-user data)', () => {
  it('only ever reads the caller-scoped list endpoint, never a per-user path', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ predicates: [predicate('p1', 'NVDA')] }) }))
    renderHook(() => useFilingWatch())
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    for (const [url] of global.fetch.mock.calls) {
      expect(String(url)).toMatch(/^\/api\/alerts\/taxonomy\/document-arrival/)
    }
  })
})
