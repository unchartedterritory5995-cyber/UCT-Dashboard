import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import useThesisChips from './useThesisChips'
import { __resetNotebookFlags, latchNotebookFlags } from '../lib/offline/notebookFlags'
import { contract, contractBody, contractResponse } from '../__fixtures__/contract'

// CONTRACT: the chips are the REAL server's answer to POST /api/j2/thesis-chips
// (`__fixtures__/contract`, written by tools/notebook_contract_fixtures.py): one note with
// levels (TCNV), one with a status and no levels (TCAM), one invalidated (TCIN).
beforeEach(() => {
  __resetNotebookFlags()
  global.fetch = vi.fn(async () => contractResponse('thesis-chips'))
})
afterEach(() => {
  __resetNotebookFlags()
  vi.restoreAllMocks()
})

describe('useThesisChips', () => {
  it('posts the WHOLE symbol set in exactly ONE request, deduped and uppercased', async () => {
    latchNotebookFlags({ notebook_thesis_chips_enabled: true })
    const { result } = renderHook(() => useThesisChips(['tcnv', 'TCAM', 'tcnv', 'TCIN', 'nope']))
    await waitFor(() => expect(result.current.chips).toHaveProperty('TCNV'))
    expect(global.fetch).toHaveBeenCalledTimes(1)
    const [url, opts] = global.fetch.mock.calls[0]
    const recorded = contract('thesis-chips')._contract
    expect(url).toBe(recorded.path)
    expect(opts.method).toBe('POST')
    expect(opts.credentials).toBe('include')
    const body = JSON.parse(opts.body)
    // the same request the answer was recorded for: one key, the same symbols
    expect(Object.keys(body)).toEqual(Object.keys(recorded.requestBody))
    expect([...body.symbols].sort()).toEqual([...recorded.requestBody.symbols].sort())
    // and the chips come back exactly as the server sent them
    expect(result.current.chips).toEqual(contractBody('thesis-chips'))
    expect(result.current.chips.TCNV).toMatchObject({ stop: 90, entry: 100, target: 120, thesisStatus: 'active' })
    expect(result.current.chips.NOPE).toBeUndefined()            // no note: absent, never a blank chip
  })

  it('no note on any symbol: the server sends an empty object, and so does the hook', async () => {
    global.fetch = vi.fn(async () => contractResponse('thesis-chips.empty'))
    latchNotebookFlags({ notebook_thesis_chips_enabled: true })
    const { result } = renderHook(() => useThesisChips(['TCNV']))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.chips).toEqual({})
  })

  it('a larger row set still costs exactly one request (the N-rows-1-request rail)', async () => {
    latchNotebookFlags({ notebook_thesis_chips_enabled: true })
    const many = Array.from({ length: 40 }, (_, i) => `S${i}`)
    const { result } = renderHook(() => useThesisChips(many))
    await waitFor(() => expect(result.current.chips).toHaveProperty('TCNV'))
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('makes NO request while the flag is off', () => {
    const { result } = renderHook(() => useThesisChips(['NVDA']))
    expect(result.current.chips).toEqual({})
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('makes no request with an empty symbol list, even with the flag on', () => {
    latchNotebookFlags({ notebook_thesis_chips_enabled: true })
    const { result } = renderHook(() => useThesisChips([]))
    expect(result.current.chips).toEqual({})
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it.each([
    ['a free plan (402)', 'thesis-chips.free-plan'],
    ['a refused body (400)', 'thesis-chips.symbols-not-a-list'],
    ['FastAPI\'s own validation answer, whose detail is a LIST (422)', 'thesis-chips.body-not-an-object'],
  ])('a failed response resolves to an empty chip map, never a thrown error or an error object as chips: %s', async (_label, name) => {
    latchNotebookFlags({ notebook_thesis_chips_enabled: true })
    global.fetch = vi.fn(async () => contractResponse(name))
    const { result } = renderHook(() => useThesisChips(['TCNV']))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.chips).toEqual({})
    expect(result.current.chips).not.toHaveProperty('detail')
  })
})
