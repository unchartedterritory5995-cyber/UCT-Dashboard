// TERM-033 -- a failed refresh must not erase the quote already on screen. The strip's fetcher
// used to resolve `null` on any failure, which SWR stored as the new answer, so one failed 60 s
// poll made the O/H/L/PC/VOL row vanish mid-session. Real SWR + real useMobileSWR; the cache is
// seeded with a good quote and the mount-time revalidation is what fails.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { SWRConfig } from 'swr'

vi.mock('../../hooks/useMarketOpen', () => ({
  default: () => ({ isOpen: true, isPremarket: false, isExtended: false }),
}))

import QuoteStrip from './QuoteStrip'

const KEY = '/api/research/quote/AAPL'
const GOOD = { sym: 'AAPL', price: 313.33, open: 311.32, high: 314.81, low: 310.74, prev_close: 312.41, volume: 34437191 }

function renderSeeded() {
  const cache = new Map([[KEY, { data: GOOD }]])
  return render(
    <SWRConfig value={{ provider: () => cache, dedupingInterval: 0 }}>
      <QuoteStrip sym="AAPL" />
    </SWRConfig>,
  )
}

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('QuoteStrip keeps the last good quote (TERM-033)', () => {
  it('a failed refresh leaves the session numbers on screen', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 404, json: async () => ({}) })
    renderSeeded()
    expect(screen.getByTestId('quote-strip').textContent).toContain('$311.32')
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith(KEY))
    // let SWR settle the rejected revalidation
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.getByTestId('quote-strip').textContent).toContain('$311.32')
  })

  it('control: a successful refresh that carries no price DOES replace it (the revalidation ran)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => ({ sym: 'AAPL', price: null }) })
    renderSeeded()
    expect(screen.getByTestId('quote-strip')).toBeTruthy()
    await waitFor(() => expect(screen.queryByTestId('quote-strip')).toBeNull())
  })
})
