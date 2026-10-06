// A request that never answers must END in a failure the member can read, never an endless
// loading line (terminal quality pass 2026-10-05). Both shared fetchers carry the deadline;
// the panel tests assert the RENDERED failure copy after the deadline passes.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { SWRConfig } from 'swr'

import { SECTION_TIMEOUT_MS, SectionTimeoutError, sectionFetcher } from './sectionFetch'
import { depthFetcher } from '../../../pages/research/depth/depthFetch'
import FtdPanel from '../../../pages/research/depth/FtdPanel'
import PeopleTab from '../../../pages/research/tabs/PeopleTab'

const never = () => new Promise(() => {})

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.stubGlobal('fetch', vi.fn(never))
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('the shared fetchers end a request that never answers', () => {
  it.each([['sectionFetcher', sectionFetcher], ['depthFetcher', depthFetcher]])(
    '%s rejects with a timeout once the deadline passes', async (_n, fetcher) => {
      const p = fetcher('/api/x')
      const settled = expect(p).rejects.toBeInstanceOf(SectionTimeoutError)
      await vi.advanceTimersByTimeAsync(SECTION_TIMEOUT_MS + 1)
      await settled
    })

  it('a prompt answer still resolves and leaves no timer behind', async () => {
    fetch.mockImplementation(() => Promise.resolve({ ok: true, status: 200, json: async () => ({ a: 1 }) }))
    await expect(sectionFetcher('/api/x')).resolves.toEqual({ a: 1 })
    expect(vi.getTimerCount()).toBe(0)
  })
})

const wrap = (el) => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>{el}</SWRConfig>,
)

describe('a hung request reads as a failure on the panel, not as loading forever', () => {
  it('FTD (depth fetcher)', async () => {
    wrap(<FtdPanel sym="gme" />)
    expect(screen.getByText(/Loading fails to deliver/)).toBeInTheDocument()
    await act(async () => { await vi.advanceTimersByTimeAsync(SECTION_TIMEOUT_MS + 1) })
    expect(screen.getByTestId('ftd-unavailable').textContent).toMatch(/unavailable right now.*not a finding about GME/)
    expect(screen.queryByText(/Loading fails to deliver/)).not.toBeInTheDocument()
  })

  it('PPL (section fetcher)', async () => {
    wrap(<PeopleTab sym="nvda" />)
    expect(screen.getByText('Loading people…')).toBeInTheDocument()
    await act(async () => { await vi.advanceTimersByTimeAsync(SECTION_TIMEOUT_MS + 1) })
    expect(screen.queryByText('Loading people…')).not.toBeInTheDocument()
    expect(screen.getByTestId('people-unavailable').textContent).toMatch(/unavailable right now.*not a finding about NVDA/)
  })
})
