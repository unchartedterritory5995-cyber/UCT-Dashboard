import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'

// TERM-062 (FB-S7-02) — the pre-save fire-frequency line. The REAL hook and the
// REAL component, with only `fetch` and the auth context faked, so what is
// asserted is the text a member reads, built from the response the route gives.

const H = vi.hoisted(() => ({ user: { id: 'u1' }, enabled: true }))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: H.user, s7FilingWatchEnabled: H.enabled }),
}))

import FilingWatchFrequency from './FilingWatchFrequency'

const DAY = 86400
const NOW = 1_790_000_000
const COOLDOWN = {
  type_id: 'document-arrival',
  sentence: 'Checked every 20 minutes. Each new filing alerts you once, and never again. '
    + 'If several land between checks, you get 1 alert, for the newest.',
}

function answer(body, ok = true, status = 200) {
  global.fetch = vi.fn(async () => ({ ok, status, json: async () => body }))
}

function freq(over = {}) {
  return {
    ticker: 'AAPL', type_id: 'document-arrival', window_days: 30,
    window_start: NOW - 30 * DAY, as_of: NOW, covered: true,
    covered_since: NOW - 30 * DAY, fires: 2, last_fired_at: NOW - DAY,
    type_last_fired_at: NOW - DAY, source: 'alert_fires', cooldown: COOLDOWN, ...over,
  }
}

// A fresh SWR cache per test: the key is per ticker, and a shared cache would
// let one test's answer satisfy the next.
const mount = (sym) => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <FilingWatchFrequency sym={sym} />
  </SWRConfig>,
)

beforeEach(() => {
  H.user = { id: 'u1' }
  H.enabled = true
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('FilingWatchFrequency — the member reads the durable count', () => {
  it('states the count over the full window, then the published re-arm rule', async () => {
    answer(freq())
    mount('aapl')
    expect(await screen.findByText('A filing watch on AAPL fired 2 times in the last 30 days.')).toBeInTheDocument()
    expect(screen.getByText(COOLDOWN.sentence)).toBeInTheDocument()
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/alerts/taxonomy/document-arrival/frequency?ticker=AAPL', undefined)
  })

  it('says "1 time", not "1 times"', async () => {
    answer(freq({ fires: 1 }))
    mount('AAPL')
    expect(await screen.findByText('A filing watch on AAPL fired 1 time in the last 30 days.')).toBeInTheDocument()
  })

  it('a watched-and-quiet ticker is a real zero', async () => {
    answer(freq({ fires: 0 }))
    mount('AAPL')
    expect(await screen.findByText('A filing watch on AAPL fired 0 times in the last 30 days.')).toBeInTheDocument()
  })

  it('🔴 an UNWATCHED ticker is "no record", never "fired 0 times"', async () => {
    answer(freq({ covered: false, fires: null, covered_since: null, last_fired_at: null }))
    mount('ZZZ')
    expect(await screen.findByText('No filing-watch record for ZZZ in the last 30 days.')).toBeInTheDocument()
    expect(screen.queryByText(/0 times/)).not.toBeInTheDocument()
  })

  it('partial coverage names when watching began instead of claiming the whole window', async () => {
    const since = Date.UTC(2026, 8, 25, 16) / 1000     // Sep 25 2026, noon ET
    answer(freq({ covered_since: since, fires: 1 }))
    mount('AAPL')
    expect(await screen.findByText('A filing watch on AAPL fired 1 time since Sep 25, 2026.')).toBeInTheDocument()
    expect(screen.queryByText(/in the last 30 days/)).not.toBeInTheDocument()
  })

  it('the window length is the one the response carries, not a typed 30', async () => {
    answer(freq({ window_days: 45, window_start: NOW - 45 * DAY, covered_since: NOW - 45 * DAY }))
    mount('AAPL')
    expect(await screen.findByText('A filing watch on AAPL fired 2 times in the last 45 days.')).toBeInTheDocument()
  })

  it('a failed read renders NOTHING — an unreadable record is not an empty one', async () => {
    answer({ detail: 'boom' }, false, 500)
    const { container } = mount('AAPL')
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    await act(() => new Promise(r => setTimeout(r, 20)))
    expect(container).toBeEmptyDOMElement()
  })

  it('makes no request while the feature is dark, or signed out', async () => {
    answer(freq())
    H.enabled = false
    const { container } = mount('AAPL')
    H.user = null
    H.enabled = true
    mount('MSFT')
    await act(() => new Promise(r => setTimeout(r, 20)))
    expect(global.fetch).not.toHaveBeenCalled()
    expect(container).toBeEmptyDOMElement()
  })
})
