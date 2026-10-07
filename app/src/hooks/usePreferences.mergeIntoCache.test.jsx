// `mergeIntoPreferenceCache` (wave 14, lane W14-C2): a value the server already holds
// goes into the SHARED cache every mounted consumer reads, with no request -- the
// sibling of `refreshPreferences`, minus the re-read.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import usePreferences, { mergeIntoPreferenceCache, parsePref } from './usePreferences'

let server
beforeEach(() => {
  server = { notebook_tours: JSON.stringify({ a: { v: 1, state: 'done', step: null } }), theme: 'oled' }
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ ...server }) }))
})
afterEach(() => { vi.restoreAllMocks() })

describe('mergeIntoPreferenceCache', () => {
  it('a mounted consumer sees the merged value, other keys untouched, and NOTHING is sent', async () => {
    // the GLOBAL cache (App.jsx's SWRConfig has no provider): the one this function writes to
    const { result } = renderHook(() => usePreferences())
    await waitFor(() => expect(result.current.loading).toBe(false))
    const before = global.fetch.mock.calls.length
    await act(async () => {
      await mergeIntoPreferenceCache('notebook_tours', (cur) => ({ ...cur, b: { v: 1, state: 'started', step: 's1' } }))
    })
    expect(parsePref(result.current.prefs.notebook_tours, {})).toEqual({
      a: { v: 1, state: 'done', step: null },
      b: { v: 1, state: 'started', step: 's1' },
    })
    expect(result.current.prefs.theme).toBe('oled')
    expect(global.fetch.mock.calls.length).toBe(before)          // no GET, no POST
    // a plain (string) value is stored as-is: the server's own answer
    await act(async () => { await mergeIntoPreferenceCache('notebook_tours', '{"z":1}') })
    expect(result.current.prefs.notebook_tours).toBe('{"z":1}')
  })

  it('an updater answering undefined changes nothing', async () => {
    const { result } = renderHook(() => usePreferences())
    await waitFor(() => expect(result.current.loading).toBe(false))
    const before = result.current.prefs.notebook_tours
    await act(async () => { await mergeIntoPreferenceCache('notebook_tours', () => undefined) })
    expect(result.current.prefs.notebook_tours).toBe(before)
  })
})
