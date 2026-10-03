/**
 * TERM-079 (FB-S4-01) — ONE LIST-CONSUMING PANEL, WIRED END TO END.
 *
 * The Market Map (ScatterWidget) plots a UNIVERSE — a list. With "Follow linked
 * list" on, it plots whatever list its colour group's `list-ref` channel holds,
 * and the Watchlist widget is the publisher: picking a list in a group-A watchlist
 * re-points a group-A Market Map. Both widgets are REAL here; only the network,
 * the canvas and the 2,000-line Watchlists table are stubbed.
 *
 * ⛔ Opt-in, so no existing board changes: a Market Map that never had the
 * toggle on reads its own saved universe exactly as before.
 */
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
import { useState } from 'react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

vi.mock('echarts-for-react', () => ({ default: () => <div data-testid="echart" /> }))

// Record every /scatter/data URL the Market Map asks for — that URL IS the universe it plots.
let dataUrls = []
vi.mock('../../../hooks/useMobileSWR', () => ({
  default: (url) => {
    if (typeof url === 'string' && url.includes('/scatter/metrics')) return { data: { metrics: [] } }
    if (typeof url === 'string' && url.includes('/scatter/universes')) return { data: { groups: [] } }
    if (typeof url === 'string' && url.includes('/scatter/data')) {
      dataUrls.push(url)
      return { data: { tickers: [{ sym: 'AAPL', dir: 'up', m: { rvol: 1, chg_today: 1 } }] }, isValidating: false }
    }
    return { data: null }
  },
}))
vi.mock('../../../hooks/usePlacedTheme', () => ({ default: () => 'dark' }))
vi.mock('../../Watchlists', () => ({
  default: ({ pickList }) => <div data-testid="watchlists-render" data-picklist={String(pickList)} />,
}))
vi.mock('./WatchlistPicker', () => ({ default: () => <div data-testid="watchlist-picker" /> }))

import ScatterWidget from './ScatterWidget'
import WatchlistWidget, { watchKeyToListRef } from './WatchlistWidget'
import { WorkspaceContext, WORKSPACE_FALLBACK } from '../WorkspaceContext'
import { ContextChannelsProvider, createChannelStore, channelFor, KIND } from '../../../lib/context/contextChannels'

const lastData = () => dataUrls[dataUrls.length - 1] || ''
const plotted = () => new URL(lastData(), 'http://x').searchParams

beforeEach(() => {
  dataUrls = []
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ points: {} }) }))
})
afterEach(() => cleanup())

/** A board: one channel store, one workspace, a watchlist and a market map. */
function Board({ store, wl, map, showWatchlist = true }) {
  const [wlOpts, setWlOpts] = useState(wl.opts)
  const [mapOpts, setMapOpts] = useState(map.opts)
  Board.setWlOpts = setWlOpts
  return (
    <ContextChannelsProvider store={store}>
      <WorkspaceContext.Provider value={WORKSPACE_FALLBACK}>
        {showWatchlist && <WatchlistWidget color={wl.color} opts={wlOpts} onOptsChange={setWlOpts} />}
        <ScatterWidget color={map.color} opts={mapOpts} onOptsChange={setMapOpts} />
      </WorkspaceContext.Provider>
    </ContextChannelsProvider>
  )
}

describe('watchKeyToListRef — the watchlist vocabulary mapped onto the universe vocabulary', () => {
  it('maps every list the Market Map can resolve server-side', () => {
    expect(watchKeyToListRef('flagged', 'Flagged')).toMatchObject({ type: 'list-ref', source: 'flagged', value: '' })
    expect(watchKeyToListRef('user:42', 'Leaders')).toMatchObject({ source: 'watchlist', value: '42', label: 'Leaders' })
    expect(watchKeyToListRef('community:77', 'Theirs')).toMatchObject({ source: 'watchlist', value: '77' })
    expect(watchKeyToListRef('tag:red', 'Red')).toMatchObject({ source: 'tag', value: 'red' })
  })
  it('⛔ publishes NOTHING for a list it cannot resolve (an alias, no key, an unknown form)', () => {
    expect(watchKeyToListRef('community:alias:weekly-leaders', 'Weekly')).toBeNull()
    expect(watchKeyToListRef(null, null)).toBeNull()
    expect(watchKeyToListRef('something-else', 'X')).toBeNull()
  })
})

describe('the Market Map follows its group\'s list-ref channel', () => {
  it('a group-A watchlist on "Leaders" re-points a following group-A Market Map to that list', () => {
    const store = createChannelStore()
    render(<Board store={store}
      wl={{ color: 'A', opts: { watchKey: 'user:42', watchName: 'Leaders' } }}
      map={{ color: 'A', opts: { followList: true } }} />)
    expect(store.get(channelFor(KIND.LIST_REF, 'A'))).toMatchObject({ source: 'watchlist', value: '42' })
    expect(plotted().get('source')).toBe('watchlist')
    expect(plotted().get('value')).toBe('42')
    expect(screen.getByText('Leaders')).toBeInTheDocument()   // the linked chip names the list
  })

  it('⛔ every publish the watchlist makes is ADMITTED — a wrong-kind publish fails here by name', () => {
    const refusals = []
    const store = createChannelStore({ onRefuse: (r) => refusals.push(r.message) })
    render(<Board store={store}
      wl={{ color: 'A', opts: { watchKey: 'user:42', watchName: 'Leaders' } }}
      map={{ color: 'A', opts: { followList: true } }} />)
    act(() => { Board.setWlOpts({ watchKey: 'flagged', watchName: 'Flagged' }) })
    act(() => { Board.setWlOpts({ watchKey: 'tag:red', watchName: 'Red' }) })
    expect(refusals).toEqual([])
    expect(store.get(channelFor(KIND.LIST_REF, 'A'))).toMatchObject({ source: 'tag', value: 'red' })
  })

  it('picking a different list in the watchlist moves the Market Map with it', () => {
    render(<Board store={createChannelStore()}
      wl={{ color: 'A', opts: { watchKey: 'user:42', watchName: 'Leaders' } }}
      map={{ color: 'A', opts: { followList: true } }} />)
    act(() => { Board.setWlOpts({ watchKey: 'flagged', watchName: 'Flagged' }) })
    expect(plotted().get('source')).toBe('flagged')
  })

  it('⛔ a Market Map in group B does not follow group A\'s list', () => {
    render(<Board store={createChannelStore()}
      wl={{ color: 'A', opts: { watchKey: 'user:42', watchName: 'Leaders' } }}
      map={{ color: 'B', opts: { followList: true } }} />)
    expect(plotted().get('source')).toBe('index')
    expect(plotted().get('value')).toBe('sp500')
  })

  it('⛔ a Market Map that never turned the toggle on plots its own universe exactly as before', () => {
    render(<Board store={createChannelStore()}
      wl={{ color: 'A', opts: { watchKey: 'user:42', watchName: 'Leaders' } }}
      map={{ color: 'A', opts: {} }} />)
    expect(dataUrls.every((u) => u.includes('source=index') && u.includes('value=sp500'))).toBe(true)
    expect(screen.queryByText('Leaders')).not.toBeInTheDocument()
  })

  it('switching the watchlist to a list the map cannot resolve CLEARS the link — no stale list', () => {
    const store = createChannelStore()
    render(<Board store={store}
      wl={{ color: 'A', opts: { watchKey: 'user:42', watchName: 'Leaders' } }}
      map={{ color: 'A', opts: { followList: true } }} />)
    act(() => { Board.setWlOpts({ watchKey: 'community:alias:weekly', watchName: 'Weekly' }) })
    expect(store.get(channelFor(KIND.LIST_REF, 'A'))).toBeNull()
    expect(plotted().get('source')).toBe('index')          // back to its own universe
    expect(screen.getByText('No linked list')).toBeInTheDocument()
  })

  it('removing the watchlist clears its list — the map falls back to its own universe', () => {
    const store = createChannelStore()
    const wl = { color: 'A', opts: { watchKey: 'user:42', watchName: 'Leaders' } }
    const map = { color: 'A', opts: { followList: true } }
    const { rerender } = render(<Board store={store} wl={wl} map={map} />)
    rerender(<Board store={store} wl={wl} map={map} showWatchlist={false} />)
    expect(store.get(channelFor(KIND.LIST_REF, 'A'))).toBeNull()
    expect(plotted().get('source')).toBe('index')
  })

  it('⛔ COV-10: a SCAN list-ref on the group is refused BY NAME — never plotted as an empty universe', () => {
    // A Scanner widget on group A publishes `scan` refs; /api/scatter/data cannot resolve
    // them. The map must say so and keep plotting its own universe.
    const store = createChannelStore()
    render(<Board store={store} showWatchlist={false}
      wl={{ color: 'A', opts: {} }}
      map={{ color: 'A', opts: { followList: true } }} />)
    act(() => {
      store.publish(channelFor(KIND.LIST_REF, 'A'),
        { type: KIND.LIST_REF, source: 'scan', value: 'top-gainers-30d', label: 'Top Gainers (30-Day)' }, 'ScannerResults#t')
    })
    expect(screen.getByText("Can't plot Top Gainers (30-Day)")).toBeInTheDocument()
    expect(dataUrls.some((u) => u.includes('source=scan'))).toBe(false)
    expect(plotted().get('source')).toBe('index')
    expect(plotted().get('value')).toBe('sp500')
  })

  it('the toggle is a real control: it persists followList, and picking a saved tab turns it off', () => {
    const onOpts = vi.fn()
    render(
      <ContextChannelsProvider>
        <WorkspaceContext.Provider value={WORKSPACE_FALLBACK}>
          <ScatterWidget color="A" opts={{}} onOptsChange={onOpts} />
        </WorkspaceContext.Provider>
      </ContextChannelsProvider>,
    )
    const btn = screen.getByRole('button', { name: /follow the linked list/i })
    expect(btn.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(btn)
    expect(onOpts).toHaveBeenLastCalledWith(expect.objectContaining({ followList: true }))
  })

  it('clicking a saved universe tab while following turns following off', () => {
    const onOpts = vi.fn()
    render(
      <ContextChannelsProvider>
        <WorkspaceContext.Provider value={WORKSPACE_FALLBACK}>
          <ScatterWidget color="A" opts={{ followList: true }} onOptsChange={onOpts} />
        </WorkspaceContext.Provider>
      </ContextChannelsProvider>,
    )
    fireEvent.click(screen.getByText('S&P 500'))
    expect(onOpts).toHaveBeenLastCalledWith(expect.objectContaining({ activeUniverse: 0, followList: false }))
  })
})
