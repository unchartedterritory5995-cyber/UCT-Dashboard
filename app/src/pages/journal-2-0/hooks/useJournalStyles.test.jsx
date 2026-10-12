// hooks/useJournalStyles.js: SWR on STYLES_URL with fetchJournalStyles. Fed through a fake `fetch`
// with an inline fixture in the plan's documented list shape (see lib/journalStyles.test.js).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { SWRConfig } from 'swr'
import useJournalStyles from './useJournalStyles'
import { STYLES_URL } from '../lib/journalStyles'

const wrapper = ({ children }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
)
const LIST = {
  kinds: [{ id: 'thesis', name: 'Thesis', icon: 'note', builtin: true, sortOrder: 0 }],
  styles: [{ id: 'builtin:thesis', name: 'Thesis', kindId: 'thesis', builtin: true, isDefault: true, version: 1, blocks: [] }],
  blockKinds: ['chart'],
}

beforeEach(() => { globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => LIST })) })
afterEach(() => { vi.restoreAllMocks() })

describe('useJournalStyles', () => {
  it('loads the list from the styles route', async () => {
    const { result } = renderHook(() => useJournalStyles(), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual(LIST))
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    expect(globalThis.fetch.mock.calls[0][0]).toBe(STYLES_URL)
    expect(result.current.error).toBeUndefined()
  })

  it('makes no request while the caller\'s gate is closed', async () => {
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
