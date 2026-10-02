/**
 * COV-10 — publish a LIST to a subscribing widget; FROZEN vs TRACKING, chosen at import.
 *
 * The board here is REAL where it matters: one real channel store, the real
 * ScannerResults as the publisher, the real WatchlistWidget as the subscriber, the
 * real SubscribeOffer / SubscribedList. Stubbed: the 2,500-line Watchlists table (it
 * renders the members it is handed, as text), the picker, the scanner's journal door,
 * and the network (`fetch` for a freeze, a seeded SWR result for a tracking read).
 *
 * Every assertion reads RENDERED text or the real store.
 */
import { render, screen, fireEvent, act, cleanup, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

// ── The network, seeded per test ────────────────────────────────────────────────
// Scanner (string key) → `scanData`. Tracking list (tuple key [url, 'cov10-track']) →
// `track[url]` = { data, error }. `trackKeys` records every tracking read requested.
let scanData = null
let track = {}
let trackKeys = []
vi.mock('../../../hooks/useMobileSWR', () => ({
  default: (key) => {
    if (Array.isArray(key)) {
      trackKeys.push(key[0])
      return { ...(track[key[0]] || {}), mutate: () => {}, isValidating: false }
    }
    if (typeof key === 'string' && key.startsWith('/api/scans/')) {
      return { data: scanData, mutate: () => {}, isValidating: false }
    }
    return { data: null, mutate: () => {}, isValidating: false }
  },
}))
vi.mock('../../../hooks/useLivePrices', () => ({ default: () => ({ prices: {} }) }))
vi.mock('../../journal-2-0/lib/sendToJournal', () => ({ sendCaptureToJournal: () => Promise.resolve('') }))
vi.mock('../../../widgets/captureRelease', () => ({ captureEnabled: () => false }))
vi.mock('../../journal-2-0/lib/useJournalToast', () => ({ useJournalToast: () => [null, () => {}], JournalToast: () => null }))
vi.mock('../../journal-2-0/components/CaptureMenu', () => ({ default: () => null }))
// The table renders what it is handed: its title and its members, as text.
vi.mock('../../Watchlists', () => ({
  default: ({ pickName, scanSymbols, pickList }) => (
    <div data-testid={pickList === '__scan__' ? 'table' : 'saved-list'}>
      <span>table:{pickName}</span>
      {Array.isArray(scanSymbols) && <span>members:{scanSymbols.join(',') || '(none)'}</span>}
    </div>
  ),
}))
vi.mock('./WatchlistPicker', () => ({ default: () => <div>list-picker</div> }))

import WatchlistWidget from './WatchlistWidget'
import ScannerResults from './ScannerResults'
import { trackState, subscriptionLine, SUB_MODE } from './ListSubscription'
import { WorkspaceContext, WORKSPACE_FALLBACK } from '../WorkspaceContext'
import { ContextChannelsProvider, createChannelStore, channelFor, KIND } from '../../../lib/context/contextChannels'

const URL_30D = '/api/scans/top-gainers-30d'
const results = (...syms) => ({ status: 'ready', as_of: '2026-10-01T14:00:00-04:00', results: syms.map((sym) => ({ sym })) })

let fetchCalls = []
function seedFetch(res) {
  global.fetch = vi.fn((url) => {
    fetchCalls.push(url)
    return Promise.resolve(res)
  })
}

beforeEach(() => {
  scanData = results('AAPL', 'NVDA')
  track = {}
  trackKeys = []
  fetchCalls = []
  seedFetch({ ok: true, status: 200, json: () => Promise.resolve(results('AAPL', 'NVDA')) })
})
afterEach(() => cleanup())

/** A board: one channel store, a scanner (group `scanColor`) and a watchlist (group `wlColor`). */
function Board({ store, on = true, scanColor = 'A', wlColor = 'A', wlOpts: initial = {}, showScanner = true }) {
  const [wlOpts, setWlOpts] = useState(initial)
  Board.wlOpts = wlOpts
  Board.setWlOpts = setWlOpts
  const ws = { ...WORKSPACE_FALLBACK, listSubscribeEnabled: on }
  return (
    <ContextChannelsProvider store={store}>
      <WorkspaceContext.Provider value={ws}>
        {showScanner && <ScannerResults scanKey="top-gainers-30d" scanName="Top Gainers (30-Day)" color={scanColor} />}
        <WatchlistWidget color={wlColor} opts={wlOpts} onOptsChange={setWlOpts} />
      </WorkspaceContext.Provider>
    </ContextChannelsProvider>
  )
}

const OFFER = /Group A is showing the scan/
/** The subscribing widget's own subtree (the scanner's table renders members too). */
const sub = () => within(document.querySelector('[data-sub-mode]'))

describe('dark: the flag off is the pre-COV-10 board', () => {
  it('the scanner publishes nothing and the watchlist offers nothing', () => {
    const store = createChannelStore()
    render(<Board store={store} on={false} />)
    expect(store.get(channelFor(KIND.LIST_REF, 'A'))).toBeNull()
    expect(screen.queryByText(OFFER)).not.toBeInTheDocument()
    expect(screen.getByText('list-picker')).toBeInTheDocument()
  })

  it('a saved subscription is IGNORED while off — the widget falls back to its picker, opts kept', () => {
    const sub = { mode: 'freeze', source: 'scan', value: 'top-gainers-30d', label: 'Top Gainers (30-Day)', at: '2026-10-01T18:00:00Z', symbols: ['AAPL'] }
    render(<Board store={createChannelStore()} on={false} showScanner={false} wlOpts={{ listSub: sub }} />)
    expect(screen.getByText('list-picker')).toBeInTheDocument()
    expect(screen.queryByText(/Frozen copy/)).not.toBeInTheDocument()
    expect(Board.wlOpts.listSub).toEqual(sub)
  })
})

describe('publish: a scanner puts its scan on its colour group', () => {
  it('the store holds a scan list-ref naming the scan', () => {
    const store = createChannelStore()
    render(<Board store={store} />)
    expect(store.get(channelFor(KIND.LIST_REF, 'A'))).toMatchObject({ source: 'scan', value: 'top-gainers-30d', label: 'Top Gainers (30-Day)' })
  })

  it('removing the scanner gives the channel up', () => {
    const store = createChannelStore()
    const { rerender } = render(<Board store={store} />)
    rerender(<Board store={store} showScanner={false} />)
    expect(store.get(channelFor(KIND.LIST_REF, 'A'))).toBeNull()
  })
})

describe('import: the member must choose, and nothing is subscribed until they do', () => {
  it('a same-group watchlist with no list offers BOTH modes and subscribes to neither', () => {
    render(<Board store={createChannelStore()} />)
    expect(screen.getByText(OFFER)).toBeInTheDocument()
    expect(screen.getByText('Top Gainers (30-Day)', { selector: 'strong' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Track it/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Freeze a copy/ })).toBeInTheDocument()
    expect(screen.getByText('list-picker')).toBeInTheDocument()      // the picker is still there
    expect(Board.wlOpts.listSub).toBeUndefined()                      // ⛔ no default mode
  })

  it('⛔ a watchlist on ANOTHER group is offered nothing', () => {
    render(<Board store={createChannelStore()} wlColor="B" />)
    expect(screen.queryByText(/is showing the scan/)).not.toBeInTheDocument()
  })

  it('⛔ a watchlist already showing a saved list is offered nothing', () => {
    render(<Board store={createChannelStore()} wlOpts={{ watchKey: 'user:42', watchName: 'Leaders' }} />)
    expect(screen.queryByText(OFFER)).not.toBeInTheDocument()
    expect(screen.getByTestId('saved-list')).toBeInTheDocument()
  })
})

describe('TRACKING — the source stays authoritative, and says how current it is', () => {
  it('Track records the choice and shows the live members, labelled TRACKING', () => {
    track[URL_30D] = { data: results('AAPL', 'NVDA') }
    render(<Board store={createChannelStore()} />)
    fireEvent.click(screen.getByRole('button', { name: /Track it/ }))
    expect(Board.wlOpts.listSub).toMatchObject({ mode: 'track', source: 'scan', value: 'top-gainers-30d' })
    expect(Board.wlOpts.listSub.symbols).toBeUndefined()            // a tracking list stores no members
    expect(screen.getByText('TRACKING')).toBeInTheDocument()
    expect(screen.getByText(/^Tracking Top Gainers \(30-Day\) · live · 2 stocks · read /)).toBeInTheDocument()
    expect(sub().getByText('members:AAPL,NVDA')).toBeInTheDocument()
  })

  it('a re-resolved source moves the list with it', () => {
    track[URL_30D] = { data: results('AAPL', 'NVDA') }
    const { rerender } = render(<Board store={createChannelStore()} />)
    fireEvent.click(screen.getByRole('button', { name: /Track it/ }))
    track[URL_30D] = { data: results('TSLA', 'AMD', 'META') }
    rerender(<Board store={createChannelStore()} />)
    expect(screen.getByText('members:TSLA,AMD,META')).toBeInTheDocument()
    expect(screen.getByText(/· live · 3 stocks ·/)).toBeInTheDocument()
  })

  it('⛔ a source that was NEVER readable says so — and shows no table, so it cannot read as empty', () => {
    track[URL_30D] = { error: new Error('HTTP 503') }
    render(<Board store={createChannelStore()} showScanner={false}
      wlOpts={{ listSub: { mode: 'track', source: 'scan', value: 'top-gainers-30d', label: 'Top Gainers (30-Day)', at: '2026-10-01T18:00:00Z' } }} />)
    expect(screen.getByRole('alert')).toHaveTextContent('SOURCE UNAVAILABLE: it could not be read (HTTP 503)')
    expect(screen.getByRole('alert')).toHaveTextContent('this is not an empty list')
    expect(screen.queryByTestId('table')).not.toBeInTheDocument()
    expect(screen.queryByText(/members:/)).not.toBeInTheDocument()
  })

  it('⛔ a source that STOPPED being readable keeps the last members and says how old they are', () => {
    track[URL_30D] = { data: results('AAPL', 'NVDA') }
    const sub = { mode: 'track', source: 'scan', value: 'top-gainers-30d', label: 'Top Gainers (30-Day)', at: '2026-10-01T18:00:00Z' }
    const store = createChannelStore()
    const { rerender } = render(<Board store={store} showScanner={false} wlOpts={{ listSub: sub }} />)
    // SWR keeps the last good data and adds the error when a later read fails.
    track[URL_30D] = { data: results('AAPL', 'NVDA'), error: new Error('HTTP 502') }
    rerender(<Board store={store} showScanner={false} wlOpts={{ listSub: sub }} />)
    expect(screen.getByRole('alert')).toHaveTextContent(/SOURCE UNREADABLE \(HTTP 502\) · showing the 2 stocks last read \w{3} \d+/)
    expect(screen.getByText('members:AAPL,NVDA')).toBeInTheDocument()
  })

  it('⛔ a scan this board no longer knows is UNAVAILABLE by name, and nothing is fetched for it', () => {
    render(<Board store={createChannelStore()} showScanner={false}
      wlOpts={{ listSub: { mode: 'track', source: 'scan', value: 'retired-scan', label: 'Retired Scan', at: '2026-10-01T18:00:00Z' } }} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Tracking Retired Scan · SOURCE UNAVAILABLE: it is not a list this board can read any more')
    expect(trackKeys).toEqual([])
  })

  it('a source that answers "nothing qualifies" says that in words', () => {
    track[URL_30D] = { data: results() }
    render(<Board store={createChannelStore()} showScanner={false}
      wlOpts={{ listSub: { mode: 'track', source: 'scan', value: 'top-gainers-30d', label: 'Top Gainers (30-Day)', at: '2026-10-01T18:00:00Z' } }} />)
    expect(screen.getByText('Tracking Top Gainers (30-Day) · live · the source holds no stocks right now')).toBeInTheDocument()
  })
})

describe('FROZEN — a copy at that moment, never re-resolved', () => {
  it('Freeze reads the source once, stores the members with the time, and labels the list FROZEN', async () => {
    render(<Board store={createChannelStore()} />)
    fireEvent.click(screen.getByRole('button', { name: /Freeze a copy/ }))
    await waitFor(() => expect(screen.getByText('FROZEN')).toBeInTheDocument())
    expect(fetchCalls).toEqual([URL_30D])
    expect(Board.wlOpts.listSub).toMatchObject({ mode: 'freeze', source: 'scan', value: 'top-gainers-30d', symbols: ['AAPL', 'NVDA'] })
    expect(screen.getByText(/^Frozen copy of Top Gainers \(30-Day\) · taken \w{3} \d+, .+ ET · 2 stocks · does not update$/)).toBeInTheDocument()
    expect(sub().getByText('members:AAPL,NVDA')).toBeInTheDocument()
  })

  it('⛔ a frozen list does not move when the source does — and never reads the source again', async () => {
    track[URL_30D] = { data: results('TSLA') }
    const store = createChannelStore()
    const { rerender } = render(<Board store={store} />)
    fireEvent.click(screen.getByRole('button', { name: /Freeze a copy/ }))
    await waitFor(() => expect(screen.getByText('FROZEN')).toBeInTheDocument())
    scanData = results('TSLA', 'AMD')
    rerender(<Board store={store} />)
    expect(sub().getByText('members:AAPL,NVDA')).toBeInTheDocument()
    expect(screen.getByText('members:TSLA,AMD')).toBeInTheDocument()   // the scanner itself moved
    expect(trackKeys).toEqual([])           // no tracking read was ever made
    expect(fetchCalls).toEqual([URL_30D])   // the one read at import
  })

  it('⛔ an unreadable source is NOT frozen as an empty list — it is refused by name, nothing saved', async () => {
    seedFetch({ ok: false, status: 402, json: () => Promise.resolve({}) })
    render(<Board store={createChannelStore()} />)
    fireEvent.click(screen.getByRole('button', { name: /Freeze a copy/ }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(
      'Could not freeze Top Gainers (30-Day): the source could not be read (HTTP 402). Nothing was saved.'))
    expect(Board.wlOpts.listSub).toBeUndefined()
  })

  it('⛔ a source holding nothing is not frozen either', async () => {
    seedFetch({ ok: true, status: 200, json: () => Promise.resolve({ status: 'computing', results: [] }) })
    render(<Board store={createChannelStore()} />)
    fireEvent.click(screen.getByRole('button', { name: /Freeze a copy/ }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(
      'Top Gainers (30-Day) holds no stocks right now (still building), so there is nothing to freeze. Nothing was saved.'))
    expect(Board.wlOpts.listSub).toBeUndefined()
  })

  it('leaving the subscription returns to the picker', async () => {
    render(<Board store={createChannelStore()} showScanner={false}
      wlOpts={{ listSub: { mode: 'freeze', source: 'scan', value: 'top-gainers-30d', label: 'Top Gainers (30-Day)', at: '2026-10-01T18:00:00Z', symbols: ['AAPL'] } }} />)
    expect(screen.getByText('members:AAPL')).toBeInTheDocument()
    act(() => { Board.setWlOpts({ ...Board.wlOpts, listSub: null }) })
    expect(screen.getByText('list-picker')).toBeInTheDocument()
  })
})

describe('trackState / subscriptionLine (pure)', () => {
  it('a failure with nothing ever read is unavailable; with an earlier read it is stale', () => {
    expect(trackState({ endpoint: URL_30D, data: undefined, error: new Error('HTTP 500') }).kind).toBe('unavailable')
    expect(trackState({ endpoint: URL_30D, data: results('A'), error: new Error('HTTP 500') }).kind).toBe('stale')
    expect(trackState({ endpoint: null }).kind).toBe('unavailable')
    expect(trackState({ endpoint: URL_30D }).kind).toBe('loading')
    expect(trackState({ endpoint: URL_30D, data: { status: 'computing', results: [] } }).kind).toBe('building')
  })
  it('a frozen line never claims to be live', () => {
    const line = subscriptionLine({ mode: SUB_MODE.FREEZE, label: 'X', at: '2026-10-01T18:00:00Z', symbols: ['A'] })
    expect(line).toMatch(/does not update$/)
    expect(line).not.toMatch(/live/)
  })
})
