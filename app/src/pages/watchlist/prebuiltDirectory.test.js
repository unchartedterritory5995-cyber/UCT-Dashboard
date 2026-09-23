/**
 * The prebuilt DIRECTORY must never carry MEMBERSHIP again.
 *
 * Measured on prod 2026-09-20: `GET /api/watchlists/prebuilt` answered with 33
 * lists carrying 4,704 item rows / 607,445 bytes to render a picker of 33 NAMES,
 * and the same request in one session ranged 172 ms warm to 9,859 ms cold.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import React from 'react'
import { SWRConfig } from 'swr'
import {
  PREBUILT_DIRECTORY_URL,
  PICKER_MY_LISTS_URL,
  usePrebuiltMembership,
  mergeMembership,
} from './prebuiltDirectory'

describe('directory URLs', () => {
  it('ask the server for the slim shape', () => {
    // If either flag is ever dropped the payload silently reverts to 607 KB, and
    // nothing else in the app would notice — the picker renders identically.
    expect(PREBUILT_DIRECTORY_URL).toContain('include_items=0')
    expect(PICKER_MY_LISTS_URL).toContain('include_items=0')
    expect(PICKER_MY_LISTS_URL).toContain('include_prebuilt=0')
  })

  it('are a single constant so every widget shares one SWR key', () => {
    // Two literals in two files are two cache keys — N mounted widgets would then
    // issue N catalogue requests instead of sharing one.
    expect(PREBUILT_DIRECTORY_URL).toBe('/api/watchlists/prebuilt?include_items=0')
  })
})

const wrapper = ({ children }) => (
  React.createElement(SWRConfig, { value: { provider: () => new Map(), dedupingInterval: 0 } }, children)
)

describe('usePrebuiltMembership', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn((url) => {
      const m = String(url).match(/\/api\/watchlists\/([^?]+)/)
      const id = m && decodeURIComponent(m[1])
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ id, name: id, items: [{ id: `${id}-1`, sym: `${id}AAA`, notes: '' }] }),
      })
    }))
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('fetches members only for the lists that are open', async () => {
    const { result } = renderHook(() => usePrebuiltMembership(['r2k']), { wrapper })
    await waitFor(() => expect(result.current.r2k).toBeTruthy())

    expect(result.current.r2k).toEqual([{ id: 'r2k-1', sym: 'r2kAAA', notes: '' }])
    const asked = fetch.mock.calls.map(c => String(c[0]))
    expect(asked).toHaveLength(1)
    expect(asked[0]).toContain('slim=1')
  })

  it('asks for nothing when no list is open', async () => {
    const { result } = renderHook(() => usePrebuiltMembership([]), { wrapper })
    await new Promise(r => setTimeout(r, 20))
    expect(result.current).toEqual({})
    expect(fetch).not.toHaveBeenCalled()
  })

  it('is keyed on the id SET, so re-opening the same list costs no request', async () => {
    const { result, rerender } = renderHook(
      ({ ids }) => usePrebuiltMembership(ids),
      { wrapper, initialProps: { ids: ['a', 'b'] } },
    )
    await waitFor(() => expect(result.current.a).toBeTruthy())
    const first = fetch.mock.calls.length

    rerender({ ids: ['b', 'a'] })          // same set, different order
    await new Promise(r => setTimeout(r, 20))
    expect(fetch.mock.calls.length).toBe(first)
  })

  it('bounds how many lists it will hydrate at once', async () => {
    const many = Array.from({ length: 30 }, (_, i) => `l${i}`)
    const { result } = renderHook(() => usePrebuiltMembership(many), { wrapper })
    await waitFor(() => expect(Object.keys(result.current).length).toBeGreaterThan(0))
    expect(fetch.mock.calls.length).toBeLessThanOrEqual(8)
  })
})

describe('mergeMembership', () => {
  const rows = [{ id: 'a', name: 'A', item_count: 3 }, { id: 'b', name: 'B', item_count: 7 }]

  it('fills in members for hydrated lists and leaves the rest renderable', () => {
    const out = mergeMembership(rows, { a: [{ sym: 'AAA' }] })
    expect(out[0].items).toEqual([{ sym: 'AAA' }])
    // ⚠️ `[]`, never undefined — every `(wl.items || [])` reader must behave exactly
    // as it did when the directory carried members.
    expect(out[1].items).toEqual([])
    // The count still tells the truth while the rows are in flight.
    expect(out[1].item_count).toBe(7)
  })

  it('does not mutate the directory rows SWR is caching', () => {
    const snapshot = JSON.parse(JSON.stringify(rows))
    mergeMembership(rows, { a: [{ sym: 'AAA' }] })
    expect(rows).toEqual(snapshot)
  })
})
