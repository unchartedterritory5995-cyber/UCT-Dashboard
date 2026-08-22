// K3's regression rail: saving or deleting a definition MUST invalidate the
// screener meta SWR key, or a freshly saved scan stays invisible in the
// "My Scans" rail category for up to useScreenerMeta's 6h dedupingInterval.
// Every other suite exercising these helpers proves the mutate doesn't BREAK
// anything; this file is the only one asserting it FIRES — a refactor that
// drops the call stays green everywhere else (the severed-wire class).
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mutate = vi.fn()
vi.mock('swr', async importOriginal => {
  const real = await importOriginal()
  return { ...real, mutate: (...a) => mutate(...a) }
})

import { saveUserDefinition, deleteUserDefinition } from './useUserDefinitions'
import { META_KEY } from '../pages/screener/hooks/useScreenerMeta'

// ⛔ PINS THE CONSTANT, NOT THE LITERAL. A hand-typed '/api/screener/meta'
// here would stay green even if useScreenerMeta's own key drifted out from
// under it — this rail exists precisely to close that gap (K3 review).

beforeEach(() => {
  mutate.mockClear()
  vi.restoreAllMocks()
})

describe('K3: the meta key is revalidated by every definition write door', () => {
  it('a successful save fires mutate(/api/screener/meta)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, json: async () => ({ def_id: 'u_1' }),
    })))
    const out = await saveUserDefinition({ compute: { kind: 'ast' } })
    expect(out.ok).toBe(true)
    expect(mutate.mock.calls.map(c => c[0])).toContain(META_KEY)
  })

  it('a REFUSED save does not touch the meta key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false, status: 422, json: async () => ({ detail: 'refused' }),
    })))
    const out = await saveUserDefinition({ compute: { kind: 'ast' } })
    expect(out.ok).toBe(false)
    expect(mutate.mock.calls.map(c => c[0])).not.toContain(META_KEY)
  })

  it('a delete fires mutate(/api/screener/meta)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })))
    await deleteUserDefinition('u_1')
    expect(mutate.mock.calls.map(c => c[0])).toContain(META_KEY)
  })
})
