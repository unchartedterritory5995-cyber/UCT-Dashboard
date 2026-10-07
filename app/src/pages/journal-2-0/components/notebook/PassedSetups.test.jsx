// Wave 13 lane 13G-1 -- Passed setups on Research Home.
//
// The server decides every number and every label; this component only words them. So the rails
// are about WORDING, read off the rendered text:
//   * nothing renders and nothing is fetched while notebook_passed_setups_enabled is off;
//   * a scored horizon reads as a signed percentage; a horizon with no bar reads as the SERVER's
//     label for why, never as a number (a missing value must never render as 0.0%);
//   * a name with no stored bars says so instead of a row of blanks;
//   * traded names are counted, never silently dropped;
//   * Add sends the symbol and day; Remove sends a DELETE for that row.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { __resetNotebookFlags, latchNotebookFlags } from '../../lib/offline/notebookFlags'
import PassedSetups from './PassedSetups'

const out = (key, sessions, pct, missing = null, label = null) => ({ key, sessions, pct, missing, label })

const LIST = {
  horizons: [1, 5, 10, 20], bestWindow: 20, tradedWithin: 10, lookbackDays: 60, tradedCount: 2,
  items: [
    { id: 'a', symbol: 'NVDA', source: 'scanner', savedDay: '2026-08-10', baseDate: '2026-08-07',
      status: 'scored', noBarsLabel: null,
      outcomes: [out('r1', 1, 1), out('r5', 5, 5), out('r10', 10, -2.25), out('r20', 20, 20), out('best20', 20, 20.5)] },
    { id: 'b', symbol: 'AMD', source: 'watchlist', savedDay: '2026-09-28', baseDate: '2026-09-26',
      status: 'pending', noBarsLabel: null,
      outcomes: [out('r1', 1, 0), out('r5', 5, null, 'missing', 'Bars missing from the store'),
        out('r10', 10, null, 'pending', 'Not yet'), out('r20', 20, null, 'pending', 'Not yet'),
        out('best20', 20, null, 'pending', 'Not yet')] },
    { id: 'c', symbol: 'ZZZZ', source: 'manual', savedDay: '2026-09-29', baseDate: null, status: 'no_bars',
      noBarsLabel: 'No stored daily bars for this name on or before the save',
      outcomes: [out('r1', 1, null, 'no_bars', 'x')] },
  ],
}

function installFetch(handler) {
  const calls = []
  global.fetch = vi.fn(async (url, init = {}) => {
    const call = { url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null }
    calls.push(call)
    const [status, body] = handler(call)
    return { ok: status < 300, status, json: async () => body }
  })
  return calls
}

const wrap = () => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <MemoryRouter><PassedSetups /></MemoryRouter>
  </SWRConfig>)

describe('PassedSetups', () => {
  beforeEach(() => {
    __resetNotebookFlags()
    latchNotebookFlags({ notebook_passed_setups_enabled: true })
  })
  afterEach(() => __resetNotebookFlags())

  it('renders nothing and fetches nothing while the gate is off', () => {
    __resetNotebookFlags()
    latchNotebookFlags({ notebook_passed_setups_enabled: false })
    global.fetch = vi.fn()
    const { container } = wrap()
    expect(container.innerHTML).toBe('')
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('words a scored horizon as a signed percentage and a missing one by the server\'s label', async () => {
    installFetch(() => [200, LIST])
    wrap()
    const nvda = (await screen.findByText('$NVDA')).closest('li')
    const cells = [...nvda.querySelectorAll('[data-outcome]')].map((c) => [c.dataset.outcome, c.textContent])
    expect(cells).toEqual([
      ['r1', '+1 day+1.0%'], ['r5', '+5 days+5.0%'], ['r10', '+10 days-2.3%'],
      ['r20', '+20 days+20.0%'], ['best20', 'Best in 20+20.5%'],
    ])
    expect(within(nvda).getByText(/Saved Aug 10 · from the Aug 7 close/)).toBeTruthy()
    expect(within(nvda).getByText('Scanner')).toBeTruthy()

    const amd = screen.getByText('$AMD').closest('li')
    const amdCells = Object.fromEntries([...amd.querySelectorAll('[data-outcome]')].map((c) => [c.dataset.outcome, c]))
    expect(amdCells.r1.textContent).toBe('+1 day0.0%')       // a real zero is a number...
    expect(amdCells.r5.textContent).toBe('+5 daysBars missing from the store')  // ...a gap never is
    expect(amdCells.r5.dataset.missing).toBe('missing')
    expect(amdCells.r20.textContent).toBe('+20 daysNot yet')
    expect(within(amd).getByText('Watchlist')).toBeTruthy()
  })

  it('a name with no stored bars says so, and traded names are counted', async () => {
    installFetch(() => [200, LIST])
    wrap()
    const z = (await screen.findByText('$ZZZZ')).closest('li')
    expect(z.querySelector('[data-no-bars]').textContent).toBe('No stored daily bars for this name on or before the save.')
    expect(z.querySelectorAll('[data-outcome]').length).toBe(0)
    expect(within(z).getByText('Added by you')).toBeTruthy()
    expect(screen.getByRole('note').textContent).toBe('2 names you traded within 10 sessions of saving are not listed.')
  })

  it('Add sends the symbol and the day; Remove sends a DELETE for that row', async () => {
    let list = { ...LIST, items: [LIST.items[0]], tradedCount: 0 }
    const calls = installFetch((c) => {
      if (c.method === 'POST') { list = { ...list, items: [...list.items, { ...LIST.items[1], symbol: 'TSLA', id: 't' }] }; return [200, { item: {} }] }
      if (c.method === 'DELETE') { list = { ...list, items: list.items.filter((i) => !c.url.endsWith(`/${i.id}`)) }; return [200, { ok: true }] }
      return [200, list]
    })
    wrap()
    await screen.findByText('$NVDA')
    fireEvent.change(screen.getByLabelText('Ticker you passed on'), { target: { value: '$tsla' } })
    fireEvent.change(screen.getByLabelText('Day you passed on it'), { target: { value: '2026-09-15' } })
    fireEvent.click(screen.getByRole('button', { name: /Add/ }))
    await screen.findByText('$TSLA')
    expect(calls.find((c) => c.method === 'POST').body).toEqual({ symbol: 'TSLA', savedOn: '2026-09-15' })

    fireEvent.click(screen.getByRole('button', { name: 'Remove NVDA from passed setups' }))
    await waitFor(() => expect(screen.queryByText('$NVDA')).toBeNull())
    expect(calls.find((c) => c.method === 'DELETE').url).toBe('/api/j2/research-capture/passed-setups/a')
  })

  it('a refused add shows the server\'s sentence', async () => {
    installFetch((c) => (c.method === 'POST'
      ? [400, { detail: 'A pass can be dated at most 60 days back.' }]
      : [200, { ...LIST, items: [] }]))
    wrap()
    await screen.findByText(/Nothing here yet/)
    fireEvent.change(screen.getByLabelText('Ticker you passed on'), { target: { value: 'NVDA' } })
    fireEvent.click(screen.getByRole('button', { name: /Add/ }))
    expect((await screen.findByRole('alert')).textContent).toBe('A pass can be dated at most 60 days back.')
  })
})

// fin-security I-3: the list is a plain read; the server refreshes after answering and says so.
describe('PassedSetups — the follow-up read after a queued refresh', () => {
  beforeEach(() => {
    __resetNotebookFlags()
    latchNotebookFlags({ notebook_passed_setups_enabled: true })
  })
  afterEach(() => __resetNotebookFlags())

  it('reads once more when the server says a refresh was queued, and only once', async () => {
    let n = 0
    const calls = installFetch(() => {
      n += 1
      return [200, { ...LIST, refreshQueued: n === 1 }]
    })
    wrap()
    await screen.findByText('$NVDA')
    await waitFor(() => expect(calls.filter((c) => c.method === 'GET')).toHaveLength(2), { timeout: 5000 })
    await new Promise((r) => setTimeout(r, 2800))
    expect(calls.filter((c) => c.method === 'GET')).toHaveLength(2)
  }, 12000)

  it('reads once when no refresh was queued', async () => {
    const calls = installFetch(() => [200, { ...LIST, refreshQueued: false }])
    wrap()
    await screen.findByText('$NVDA')
    await new Promise((r) => setTimeout(r, 2800))
    expect(calls.filter((c) => c.method === 'GET')).toHaveLength(1)
  }, 8000)
})
