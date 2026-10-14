// useJournalRules (fix round 1, m7): the list it asks for. The My rules block's "All rules" reads the
// dismissed list through the same hook, so the URL is pinned for each status and for no account.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { SWRConfig } from 'swr'
import useJournalRules from './useJournalRules'

const realFetch = globalThis.fetch
beforeEach(() => {
  globalThis.fetch = vi.fn(async (url) => ({ ok: true, status: 200, json: async () => [{ id: String(url) }] }))
})
afterEach(() => { globalThis.fetch = realFetch })

const wrapper = ({ children }) => createElement(SWRConfig, { value: { provider: () => new Map(), dedupingInterval: 0 } }, children)
const urls = () => globalThis.fetch.mock.calls.map((c) => c[0])

describe('useJournalRules: the status it asks for', () => {
  it('no status: the active list (the default every other caller uses)', async () => {
    const { result } = renderHook(() => useJournalRules('a 1'), { wrapper })
    await waitFor(() => expect(result.current.rules).toHaveLength(1))
    expect(urls()).toEqual(['/api/j2/accounts/a%201/rules?status=active'])
    expect(typeof result.current.mutate).toBe('function')
  })
  it("'dismissed': the dismissed list", async () => {
    const { result } = renderHook(() => useJournalRules('a1', 'dismissed'), { wrapper })
    await waitFor(() => expect(result.current.rules).toHaveLength(1))
    expect(urls()).toEqual(['/api/j2/accounts/a1/rules?status=dismissed'])
  })
  it('any other status reads as active, never passed through to the URL', async () => {
    const { result } = renderHook(() => useJournalRules('a1', 'all&x=1'), { wrapper })
    await waitFor(() => expect(result.current.rules).toHaveLength(1))
    expect(urls()).toEqual(['/api/j2/accounts/a1/rules?status=active'])
  })
  it('no account: nothing is asked for', () => {
    const { result } = renderHook(() => useJournalRules(null, 'dismissed'), { wrapper })
    expect(result.current.rules).toEqual([])
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})
