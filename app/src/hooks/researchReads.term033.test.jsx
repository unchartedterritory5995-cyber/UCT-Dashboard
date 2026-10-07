// TERM-033 -- four research reads the terminal's DES/FA/EE doors reach. Each used to answer a
// failed request with `null`, which SWR stored as the new answer: a failed refresh wiped what
// was on screen, and a failed first read was never asked again. Real SWR, real hooks; only
// `fetch` and the market clock are stood in. For each hook:
//   * a failed REFRESH keeps the last good answer (the cache is seeded, the revalidation fails);
//   * control: a successful refresh with a NEW answer replaces it (so the revalidation ran);
//   * a 402 is still an absent answer, never a `{paywalled}` object a card would draw.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'

vi.mock('./useMarketOpen', () => ({
  default: () => ({ isOpen: true, isPremarket: false, isExtended: false }),
}))

import useFundamentals from './useFundamentals'
import useExpectedMove from './useExpectedMove'
import useFundamentalSnapshot from './useFundamentalSnapshot'
import useEarningsTable from './useEarningsTable'

const CASES = [
  { name: 'useFundamentals', key: '/api/fundamentals/NVDA', run: () => useFundamentals('NVDA') },
  { name: 'useExpectedMove', key: '/api/research/expected-move/NVDA', run: () => useExpectedMove('NVDA') },
  { name: 'useFundamentalSnapshot', key: '/api/research/snapshot/NVDA', run: () => useFundamentalSnapshot('NVDA') },
  { name: 'useEarningsTable', key: '/api/fundamentals/earnings-table?sym=NVDA', run: () => useEarningsTable('NVDA') },
]

const OLD = { tag: 'old', quarterly: [] }
const NEW = { tag: 'new', quarterly: [] }

function seeded(key) {
  const cache = new Map([[key, { data: OLD }]])
  return ({ children }) => (
    <SWRConfig value={{ provider: () => cache, dedupingInterval: 0, shouldRetryOnError: false }}>{children}</SWRConfig>
  )
}
const fresh = ({ children }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>{children}</SWRConfig>
)

const respond = (status, body) => vi.spyOn(globalThis, 'fetch').mockResolvedValue({
  ok: status >= 200 && status < 300, status, json: async () => body,
})

afterEach(() => { vi.restoreAllMocks() })

describe.each(CASES)('$name (TERM-033)', ({ key, run }) => {
  it('a failed refresh keeps the last good answer', async () => {
    respond(404, {})
    const { result } = renderHook(run, { wrapper: seeded(key) })
    expect(result.current.data).toEqual(OLD)
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith(key))
    await new Promise((r) => setTimeout(r, 20))
    expect(result.current.data).toEqual(OLD)
  })

  it('control: a successful refresh replaces it', async () => {
    respond(200, NEW)
    const { result } = renderHook(run, { wrapper: seeded(key) })
    await waitFor(() => expect(result.current.data).toEqual(NEW))
  })

  it('a 402 is an absent answer, not a {paywalled} object', async () => {
    respond(402, {})
    const { result } = renderHook(run, { wrapper: fresh })
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith(key))
    await new Promise((r) => setTimeout(r, 20))
    expect(result.current.data ?? null).toBeNull()
  })
})
