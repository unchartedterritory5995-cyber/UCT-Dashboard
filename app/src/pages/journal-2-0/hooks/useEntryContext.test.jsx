// hooks/useEntryContext.js: the client's reads of the market context frozen at the fill, and
// the "why did you take it" write. Every answer here is the one the SERVER really gives
// (contract fixtures), fed through a fake `fetch`.
//
// What a member depends on:
//   * "nothing was captured" is DATA with the server's own reason, never an error banner;
//   * a free plan (402) is not an error either: the card renders nothing, like the switch off;
//   * every other failure IS an error, never an empty context;
//   * saving the why note shows the server's own sentence when it refuses.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { SWRConfig } from 'swr'
import {
  ENTRY_CONTEXT_FLAG, entryContextEnabled, useEntryContextMeta, useEntryContextFor, putWhy,
} from './useEntryContext'
import { latchNotebookFlags, __resetNotebookFlags } from '../lib/offline/notebookFlags'
import { contract, contractBody, contractResponse, nonJsonResponse } from '../__fixtures__/contract'

const wrapper = ({ children }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
)
const on = () => latchNotebookFlags({ [ENTRY_CONTEXT_FLAG]: true })

let calls
let server
beforeEach(() => {
  calls = []
  server = () => { throw new Error('this test did not expect a request') }
  global.fetch = vi.fn(async (url, init = {}) => {
    const call = { url: String(url), method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null, init }
    calls.push(call)
    return server(call)
  })
})
afterEach(() => { __resetNotebookFlags(); vi.restoreAllMocks() })

describe('the gate', () => {
  it('is off until the server sends a real true', () => {
    expect(entryContextEnabled()).toBe(false)
    latchNotebookFlags({ [ENTRY_CONTEXT_FLAG]: 1, notebook_offline_read_on: true })
    expect(entryContextEnabled()).toBe(false)
  })

  it('is on for true', () => {
    on()
    expect(entryContextEnabled()).toBe(true)
  })
})

describe('useEntryContextMeta: the server\'s field list, reasons and limits', () => {
  it('fetches nothing while the switch is off', () => {
    const { result } = renderHook(() => useEntryContextMeta(), { wrapper })
    expect(result.current).toEqual({ meta: null, error: null })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('returns the meta exactly as the server sent it', async () => {
    on()
    server = () => contractResponse('entry-context.meta')
    const { result } = renderHook(() => useEntryContextMeta(), { wrapper })
    await waitFor(() => expect(result.current.meta).not.toBeNull())
    expect(result.current.meta).toEqual(contractBody('entry-context.meta'))
    expect(calls[0].url).toBe('/api/j2/entry-context/meta')
    expect(calls[0].init.credentials).toBe('include')
    // The two things the UI reads from it and must never hardcode:
    expect(result.current.meta.whyMaxChars).toBeGreaterThan(0)
    expect(Object.keys(result.current.meta.missingReasons).length).toBeGreaterThan(3)
  })

  it('a failed read is an error with no meta, never an empty field list', async () => {
    on()
    server = () => nonJsonResponse(503)
    const { result } = renderHook(() => useEntryContextMeta(), { wrapper })
    await waitFor(() => expect(result.current.error).not.toBeNull())
    expect(result.current.error.status).toBe(503)
    expect(result.current.meta).toBeNull()
  })
})

describe('useEntryContextFor: one position\'s or trade\'s frozen context', () => {
  const EMPTY = { paidOut: false, status: null, key: null, context: null, reason: null, error: null, isLoading: false }

  it('fetches nothing and reports nothing while the switch is off', () => {
    const { result } = renderHook(() => useEntryContextFor('position', 'ec-today'), { wrapper })
    expect(result.current).toMatchObject({ enabled: false, ...EMPTY })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it.each([['null', null], ['undefined', undefined]])('fetches nothing for an id of %s, and is not "loading"', (_label, id) => {
    on()
    const { result } = renderHook(() => useEntryContextFor('position', id), { wrapper })
    expect(result.current).toMatchObject({ enabled: true, ...EMPTY })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('returns the captured context exactly as the server sent it', async () => {
    on()
    server = () => contractResponse('entry-context.position.captured')
    const sent = contractBody('entry-context.position.captured')
    const { result } = renderHook(() => useEntryContextFor('position', 'ec-today'), { wrapper })
    expect(result.current.isLoading).toBe(true)
    await waitFor(() => expect(result.current.context).not.toBeNull())
    expect(result.current).toMatchObject({ enabled: true, paidOut: false, status: 'captured', error: null, isLoading: false })
    expect(result.current.key).toEqual(sent.key)
    expect(result.current.context).toEqual(sent.context)
    expect(result.current.reason).toBeNull()
    expect(calls[0].url).toBe(contract('entry-context.position.captured')._contract.path)
    expect(calls[0].init.credentials).toBe('include')
  })

  it('reads a trade by the trade route, with the id escaped', async () => {
    on()
    server = () => contractResponse('entry-context.trade.captured')
    renderHook(() => useEntryContextFor('trade', 'a/b c'), { wrapper })
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0].url).toBe('/api/j2/entry-context/trade/a%2Fb%20c')
  })

  it('an id of 0 is still an id', async () => {
    on()
    server = () => contractResponse('entry-context.position.not-captured')
    renderHook(() => useEntryContextFor('position', 0), { wrapper })
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0].url).toBe('/api/j2/entry-context/position/0')
  })

  it('"nothing was captured" is DATA with the server\'s reason, not an error', async () => {
    on()
    server = () => contractResponse('entry-context.position.not-captured')
    const sent = contractBody('entry-context.position.not-captured')
    const { result } = renderHook(() => useEntryContextFor('position', 'ec-old'), { wrapper })
    await waitFor(() => expect(result.current.status).toBe('not_captured'))
    expect(result.current.context).toBeNull()
    expect(result.current.reason).toBe(sent.reason)
    expect(result.current.reason).toMatch(/never reconstructed/)
    expect(result.current.key).toEqual(sent.key)
    expect(result.current.error).toBeNull()
    expect(result.current.paidOut).toBe(false)
  })

  it('a free plan is paidOut, NOT an error: the card renders nothing', async () => {
    on()
    server = () => contractResponse('entry-context.position.free-plan')
    const { result } = renderHook(() => useEntryContextFor('position', 'ec-today'), { wrapper })
    await waitFor(() => expect(result.current.paidOut).toBe(true))
    expect(result.current.error).toBeNull()
    expect(result.current.context).toBeNull()
    expect(result.current.status).toBeNull()
    expect(result.current.isLoading).toBe(false)
  })

  it('another member\'s position is an error (404), never "not captured"', async () => {
    on()
    server = () => contractResponse('entry-context.position.not-found')
    const { result } = renderHook(() => useEntryContextFor('position', 'ec-theirs'), { wrapper })
    await waitFor(() => expect(result.current.error).not.toBeNull())
    expect(result.current.error.status).toBe(404)
    expect(result.current.error.message).toBe('Entry context request failed (404)')
    expect(result.current).toMatchObject({ paidOut: false, status: null, context: null, reason: null, isLoading: false })
  })

  it('a server failure is an error, never an empty context', async () => {
    on()
    server = () => nonJsonResponse(503)
    const { result } = renderHook(() => useEntryContextFor('position', 'ec-today'), { wrapper })
    await waitFor(() => expect(result.current.error).not.toBeNull())
    expect(result.current.error.status).toBe(503)
    expect(result.current.context).toBeNull()
    expect(result.current.paidOut).toBe(false)
  })

  it('a dropped connection is an error, and Try again reads once more', async () => {
    on()
    server = () => { throw new TypeError('Failed to fetch') }
    const { result } = renderHook(() => useEntryContextFor('position', 'ec-today'), { wrapper })
    await waitFor(() => expect(result.current.error).not.toBeNull())
    expect(result.current.paidOut).toBe(false)
    server = () => contractResponse('entry-context.position.captured')
    await act(async () => { await result.current.retry() })
    await waitFor(() => expect(result.current.context).not.toBeNull())
    expect(result.current.error).toBeNull()
    expect(calls).toHaveLength(2)
  })

  it('does not retry a failed read on its own', async () => {
    on()
    server = () => nonJsonResponse(503)
    const { result } = renderHook(() => useEntryContextFor('position', 'ec-today'), { wrapper })
    await waitFor(() => expect(result.current.error).not.toBeNull())
    await new Promise((r) => setTimeout(r, 60))
    expect(calls).toHaveLength(1)
  })
})

describe('putWhy: the "why did you take it" note', () => {
  const sent = () => contract('entry-context.why.saved')._contract.requestBody

  it('sends the fields the server reads (the key, the text and the base version), and returns its answer', async () => {
    server = () => contractResponse('entry-context.why.saved')
    const { symbol, entryDay, text } = sent()
    const out = await putWhy(symbol, entryDay, text)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ url: '/api/j2/entry-context/why', method: 'PUT' })
    expect(calls[0].body).toEqual(sent())                       // exactly the recorded request body
    expect(calls[0].init.credentials).toBe('include')
    expect(calls[0].init.headers['Content-Type']).toBe('application/json')
    expect(out).toEqual(contractBody('entry-context.why.saved'))
    expect(out.context.why.text).toBe(text)
  })

  it('an empty string is sent as an empty string, which clears the note', async () => {
    server = () => contractResponse('entry-context.why.saved')
    await putWhy('ECNV', '2026-10-05', '')
    // `baseUpdatedAt: null` = "I read no saved note" (data lane I5: the save is a compare-and-set).
    expect(calls[0].body).toEqual({ symbol: 'ECNV', entryDay: '2026-10-05', text: '', baseUpdatedAt: null })
  })

  it('throws the server\'s sentence when there is no context to attach the note to', async () => {
    server = () => contractResponse('entry-context.why.no-context')
    const sentence = contractBody('entry-context.why.no-context').detail
    expect(sentence).toMatch(/nothing to attach/)               // non-vacuity
    await expect(putWhy('ECAM', '2026-10-01', 'late')).rejects.toMatchObject({ message: sentence, status: 409 })
  })

  it('throws the server\'s sentence when the note is too long', async () => {
    server = () => contractResponse('entry-context.why.too-long')
    await expect(putWhy('ECNV', '2026-10-05', 'x'.repeat(501)))
      .rejects.toMatchObject({ message: contractBody('entry-context.why.too-long').detail, status: 422 })
  })

  it('throws the plan sentence for a free member', async () => {
    server = () => contractResponse('entry-context.position.free-plan')
    await expect(putWhy('ECNV', '2026-10-05', 'x')).rejects.toMatchObject({
      message: 'The entry context requires a paid plan', status: 402,
    })
  })

  it('says which status failed when the refusal has no readable body', async () => {
    server = () => nonJsonResponse(502)
    await expect(putWhy('ECNV', '2026-10-05', 'x')).rejects.toMatchObject({ message: 'Could not save (502)', status: 502 })
  })

  it('says which status failed when the body is JSON without a detail', async () => {
    server = () => ({ ok: false, status: 500, json: async () => ({}) })
    await expect(putWhy('ECNV', '2026-10-05', 'x')).rejects.toMatchObject({ message: 'Could not save (500)', status: 500 })
  })

  it('a dropped connection rejects: the caller must not show "Saved"', async () => {
    server = () => { throw new TypeError('Failed to fetch') }
    await expect(putWhy('ECNV', '2026-10-05', 'x')).rejects.toThrow('Failed to fetch')
  })
})
