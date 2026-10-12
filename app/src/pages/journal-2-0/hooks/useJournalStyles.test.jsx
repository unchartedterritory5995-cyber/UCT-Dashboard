// hooks/useJournalStyles.js: SWR on STYLES_URL with fetchJournalStyles. Fed through a fake `fetch`
// with an inline fixture in the plan's documented list shape (see lib/journalStyles.test.js).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { SWRConfig } from 'swr'
import useJournalStyles from './useJournalStyles'
import { STYLES_URL } from '../lib/journalStyles'
import { JOURNAL_STYLES_FLAG } from '../lib/journalStylesFlag'
import { latchNotebookFlags, __resetNotebookFlags } from '../lib/offline/notebookFlags'

const wrapper = ({ children }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
)
const LIST = {
  kinds: [{ id: 'thesis', name: 'Thesis', icon: 'note', builtin: true, sortOrder: 0 }],
  styles: [{ id: 'builtin:thesis', name: 'Thesis', kindId: 'thesis', builtin: true, isDefault: true, version: 1, blocks: [] }],
  blockKinds: ['chart'],
}

const gateOn = () => latchNotebookFlags({ [JOURNAL_STYLES_FLAG]: true })

beforeEach(() => { globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => LIST })) })
afterEach(() => { __resetNotebookFlags(); vi.restoreAllMocks() })

describe('the hook fails closed on the switch itself', () => {
  it('gate OFF and `enabled` omitted: no request, no data', async () => {
    const { result } = renderHook(() => useJournalStyles(), { wrapper })
    await act(async () => { await Promise.resolve() })
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(result.current.data).toBeUndefined()
  })

  it('gate OFF and the caller says `enabled: true`: still no request (a caller can narrow the gate, never widen it)', async () => {
    renderHook(() => useJournalStyles({ enabled: true }), { wrapper })
    await act(async () => { await Promise.resolve() })
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('gate ON and `enabled` omitted: one request', async () => {
    gateOn()
    const { result } = renderHook(() => useJournalStyles(), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual(LIST))
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })
})

describe('useJournalStyles (gate on)', () => {
  beforeEach(() => gateOn())

  it('loads the list from the styles route', async () => {
    const { result } = renderHook(() => useJournalStyles(), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual(LIST))
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    expect(globalThis.fetch.mock.calls[0][0]).toBe(STYLES_URL)
    expect(result.current.error).toBeUndefined()
  })

  it.each([[null], [0], ['']])('a falsy non-boolean `enabled` (%s) narrows it too, gate on', async (value) => {
    renderHook(() => useJournalStyles({ enabled: value }), { wrapper })
    await act(async () => { await Promise.resolve() })
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('makes no request when the caller narrows it (`enabled: false`), gate on or not', async () => {
    const { result } = renderHook(() => useJournalStyles({ enabled: false }), { wrapper })
    await act(async () => { await Promise.resolve() })
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(result.current.data).toBeUndefined()
  })

  it('a server refusal is the hook\'s error, with the status, and is not retried', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 402, json: async () => ({ detail: 'Journal styles require a paid plan' }) }))
    const { result } = renderHook(() => useJournalStyles(), { wrapper })
    await waitFor(() => expect(result.current.error).toBeDefined())
    expect(result.current.error).toMatchObject({ status: 402, message: 'Journal styles require a paid plan' })
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  it('mutate() re-reads, so a manager that just saved a style sees it', async () => {
    const { result } = renderHook(() => useJournalStyles(), { wrapper })
    await waitFor(() => expect(result.current.data).toBeDefined())
    const next = { ...LIST, styles: [...LIST.styles, { ...LIST.styles[0], id: 's_new', builtin: false, isDefault: false }] }
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => next }))
    await act(async () => { await result.current.mutate() })
    expect(result.current.data.styles.map((s) => s.id)).toEqual(['builtin:thesis', 's_new'])
  })
})
