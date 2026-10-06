// tq-panels (RSCH): the Ticker Research read had no deadline -- a hung request left the
// workspace on its skeleton forever. Asserted on the rendered failure copy.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { SECTION_TIMEOUT_MS } from '../../../utils/withDeadline'
import { fetchTickerResearch } from './useTickerResearch'
import TickerResearchWorkspace from '../components/notebook/TickerResearchWorkspace'

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('Ticker Research read deadline', () => {
  it('the fetcher rejects as timed out after the deadline', async () => {
    const p = fetchTickerResearch('/api/j2/notes/research/NVDA/summary')
    const settled = expect(p).rejects.toMatchObject({ timedOut: true })
    await vi.advanceTimersByTimeAsync(SECTION_TIMEOUT_MS + 1)
    await settled
  })

  it('a hung read ends on the failure copy, not loading forever', async () => {
    render(
      <MemoryRouter>
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
          <TickerResearchWorkspace symbol="NVDA" showBackLink={false} />
        </SWRConfig>
      </MemoryRouter>,
    )
    await vi.advanceTimersByTimeAsync(SECTION_TIMEOUT_MS + 1)
    expect(await screen.findByText(/Couldn't (load|reach the server to load) your research on NVDA/)).toBeInTheDocument()
  })
})
