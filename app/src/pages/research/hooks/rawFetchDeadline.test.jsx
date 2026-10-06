// The research hooks that keep their own {ok, httpStatus, body} fetchers (and jsonFetcher, used by
// MOVE) had no deadline: a request that never answered left the panel on its loading line
// forever. Each now ends in a failed read the tab already renders (quality pass 2026-10-05).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { SWRConfig } from 'swr'

import { SECTION_TIMEOUT_MS } from '../../../utils/withDeadline'
import { fetchCompanyNews } from './useCompanyNews'
import { fetchOwnership } from './useOwnership'
import { fetchDecisionRecord } from './useDecisionRecord'
import { fetchFilings } from '../../../hooks/useFilings'
import jsonFetcher from '../../../utils/jsonFetcher'
import OwnershipTab from '../tabs/OwnershipTab'

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('hung requests end as failed reads', () => {
  it.each([
    ['company news', fetchCompanyNews], ['ownership', fetchOwnership],
    ['decision record', fetchDecisionRecord], ['filings', fetchFilings],
  ])('%s fetcher answers {ok:false} after the deadline', async (_n, f) => {
    const p = f('/api/x')
    await vi.advanceTimersByTimeAsync(SECTION_TIMEOUT_MS + 1)
    await expect(p).resolves.toMatchObject({ ok: false })
  })

  it('jsonFetcher (MOVE) rejects after the deadline', async () => {
    const p = jsonFetcher('/api/x')
    const settled = expect(p).rejects.toMatchObject({ timedOut: true })
    await vi.advanceTimersByTimeAsync(SECTION_TIMEOUT_MS + 1)
    await settled
  })

  it('OWN shows its failure copy with Retry, not loading forever', async () => {
    render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}><OwnershipTab sym="nvda" /></SWRConfig>)
    await act(async () => { await vi.advanceTimersByTimeAsync(SECTION_TIMEOUT_MS + 1) })
    const err = screen.getByTestId('ownership-error')
    expect(err.textContent).toMatch(/Couldn't load ownership data/)
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })
})
