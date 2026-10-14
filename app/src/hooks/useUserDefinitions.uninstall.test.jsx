// app/src/hooks/useUserDefinitions.uninstall.test.jsx — A1.4 (WS3 P2-2)
//
// A formula deleted elsewhere stops drawing: an AUTHORITATIVE, successful store response that
// no longer contains an id a previous response installed uninstalls it. Never on an error or
// while loading, and never an id installed by another path (BuilderSheet's post-save install).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'

let swrAnswer = { data: undefined, error: undefined, isLoading: true }
vi.mock('swr', async (importOriginal) => {
  const real = await importOriginal()
  return { ...real, default: () => swrAnswer, mutate: vi.fn() }
})

import { AuthContext } from '../context/AuthContext'
import { useInstalledUserDefinitions } from './useUserDefinitions'
import * as registry from '../components/chart/engine/nativeRegistry'

const FIX = JSON.parse(fs.readFileSync(path.resolve(globalThis.process.cwd(), '..', 'tests/fixtures/authoring/batch2_definitions.json'), 'utf8'))
const A = 'u_aaaaaaaaaa41'
const B = 'u_aaaaaaaaaa42'
const row = (id) => ({ def_id: id, version: 4, rev: 1, definition: { ...FIX.styled_markers, id, version: 4 } })
const wrapper = ({ children }) => <AuthContext.Provider value={{ user: { id: 'm1' } }}>{children}</AuthContext.Provider>
const has = (id) => !!registry.getDefinition(id)

beforeEach(() => { swrAnswer = { data: undefined, error: undefined, isLoading: true } })

describe('A1.4 — uninstall on absence', () => {
  it('a successful response without a previously installed id uninstalls it; others stay', () => {
    swrAnswer = { data: [row(A), row(B)], error: undefined, isLoading: false }
    const h = renderHook(() => useInstalledUserDefinitions(), { wrapper })
    expect(has(A) && has(B)).toBe(true)
    expect([...h.result.current.storeDefIds].sort()).toEqual([A, B])
    swrAnswer = { data: [row(B)], error: undefined, isLoading: false }
    h.rerender()
    expect(has(A), 'a deleted formula kept drawing').toBe(false)
    expect(has(B)).toBe(true)
    h.unmount()
  })

  it('an ERROR response never uninstalls', () => {
    swrAnswer = { data: [row(A)], error: undefined, isLoading: false }
    const h = renderHook(() => useInstalledUserDefinitions(), { wrapper })
    expect(has(A)).toBe(true)
    swrAnswer = { data: [], error: Object.assign(new Error('boom'), { status: 503 }), isLoading: false }
    h.rerender()
    expect(has(A), 'a transport error evicted a formula').toBe(true)
    h.unmount()
  })

  it('an id installed by ANOTHER path (BuilderSheet post-save) is never evicted by a response that predates it', () => {
    swrAnswer = { data: [row(B)], error: undefined, isLoading: false }
    const h = renderHook(() => useInstalledUserDefinitions(), { wrapper })
    const C = 'u_aaaaaaaaaa43'
    registry.installUserDefinitions([{ ...FIX.styled_markers, id: C, version: 4 }])
    expect(has(C)).toBe(true)
    swrAnswer = { data: [row(B)], error: undefined, isLoading: false, _stale: 1 }
    h.rerender()
    swrAnswer = { data: [{ ...row(B), rev: 2 }], error: undefined, isLoading: false }
    h.rerender()
    expect(has(C), 'a stale response evicted a just-saved formula').toBe(true)
    h.unmount()
  })
})
