// CHARTS OUTCOME — the watchlist and list-widget family, over the REAL widget: the real WatchlistWidget + Watchlists.jsx mounted
// on the same page as the real Agent panel, with the real host sources (host.js), the real column writer and the real
// Flagged store. Assertions read what the WIDGET DRAWS (`[data-watch-sym]`, the row star), the storage the widget persists,
// and the fixture server: never a registry entry, and a receipt only alongside state.
//
// ⛔ THE MODEL IS SCRIPTED. Each phrasing below is what a member might type, paired with the plan a correct planner would
// send, and that plan is built from the REQUEST the panel sent (a target from `body.context`). This proves the request
// carries what is needed and that the plan does the right thing to the state. It does NOT prove the real model will choose
// that plan for that phrasing: that needs a paid eval, which was not run. Numbers below are invented fixture data.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup, fireEvent, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useMemo, useRef, useState } from 'react'
import { open, outcomeSuite, afterEachOutcome, chart, must, waitFor, proposalsNow } from './outcomeHarness'
import { AuthContext } from '../../../context/AuthContext'
import { WorkspaceContext } from '../../../pages/charts/WorkspaceContext'
import { buildFlaggedSource, buildListViewSource } from '../../host'
import { writeFlagged } from '../../../hooks/flaggedStore'
import { getCapability } from '../../capabilities'
import { mountedListViews } from '../../../pages/watchlist/watchlistViews'
import { ChartsSymContext } from '../../../pages/charts/ChartsSymContext'

vi.mock('../../../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
vi.mock('../../../components/StockChart', () => ({ default: () => null }))
vi.mock('../../../components/chart/SymbolSearch', () => ({ default: () => null }))
vi.mock('../../../components/CompanyLogo', () => ({ default: () => null }))
vi.mock('../../../utils/prefetchBars', () => ({
  prefetchBars: () => {}, prefetchBarsToIDB: () => {}, prefetchAllTimeframes: () => {},
  prefetchBarOnIntent: () => {}, prefetchListAllTimeframes: () => {}, warmMemFromIDB: () => {}, prewarmVisibleList: () => {},
}))
vi.mock('../../../lib/chartReadoutStore', () => ({ subscribeChartReadouts: () => () => {}, getChartReadout: () => null, hasFreshReadouts: () => false }))
const data = vi.hoisted(() => ({ lists: () => [], prices: {}, meta: {} }))
vi.mock('swr', async (orig) => ({
  ...(await orig()),
  default: (key) => (key === '/api/watchlists' ? { data: data.lists(), mutate: () => {} } : { data: [], mutate: () => {} }),
}))
vi.mock('../../../hooks/useTickerTags', () => ({ default: () => ({ tags: {}, setTag: () => {}, removeTag: () => {}, getTag: () => null, shared: [], isColorShared: () => false, toggleShareColor: () => {}, communityTags: [] }) }))
vi.mock('../../../hooks/useWatchlistAlerts', () => ({ default: () => ({ alerts: [], createAlert: () => {}, deleteAlert: () => {}, getAlertsForSym: () => [], hasAlert: () => false }) }))
vi.mock('../../../hooks/useTagColors', () => ({ default: () => ({ tagColors: [], tagByKey: {}, setTagLabel: () => {} }) }))
vi.mock('../../../hooks/usePreferences', () => ({ default: () => ({ prefs: {}, setPref: () => {}, loading: false }), parsePref: (raw, fallback) => fallback }))
vi.mock('../../../hooks/useRealtimePrices', () => ({ default: () => ({ prices: data.prices, isLoading: false, isStreaming: false, staleSymbols: new Set() }) }))
vi.mock('../../../hooks/useWatchlistPerformance', () => ({ default: () => ({ perfData: {}, isLoading: false }) }))
vi.mock('../../../hooks/useWatchlistMeta', () => ({ default: () => ({ metaData: data.meta, isLoading: false }) }))
vi.mock('../../../hooks/useWatchlistThemes', () => ({ default: () => ({ themeData: {}, isLoading: false }) }))
vi.mock('../../../hooks/useBreakpoint', () => ({
  useIsTouch: () => false, useIsPhone: () => false, useIsTablet: () => false, useIsDesktop: () => true, useHasCoarsePointer: () => false, useHasNoHover: () => false,
}))
vi.mock('../../../pages/charts/useListSubscribeEnabled', () => ({ default: () => false }))

const { default: WatchlistWidget } = await import('../../../pages/charts/widgets/WatchlistWidget')
const { default: Watchlists } = await import('../../../pages/Watchlists')
await outcomeSuite()

const COLS = 'uct.watchlist.cols'
const FLAGGED = 'uct_flagged'
const LISTS = [
  { id: 'w1', name: 'Momentum', symbols: ['NVDA', 'TSLA', 'AMD', 'AAPL', 'MSFT'], notes: { TSLA: 'a note that must survive' } },
  { id: 'w2', name: 'Earnings', symbols: ['CRM', 'ADBE'] },
]
const quote = (price, volume, change_pct) => ({ price, volume, change_pct, prev_close: price })
const PRICES = { NVDA: quote(10, 500, 1), TSLA: quote(40, 300, -2), AMD: quote(30, 100, 4), AAPL: quote(20, 200, 3), MSFT: quote(50, 400, 2), CRM: quote(60, 10, 1), ADBE: quote(70, 20, 2) }
const META = { NVDA: { rvol: 150 }, TSLA: { rvol: 900 }, AMD: { rvol: 300 }, AAPL: { rvol: 700 }, MSFT: { rvol: 500 } }
const RVOL_ORDER = ['TSLA', 'AAPL', 'MSFT', 'AMD', 'NVDA']
const SAVED = LISTS[0].symbols

let groupSyms = {}
let activeRef = { current: null }
/** The board's real widget. Group colours as on /charts: the widget reads and writes its group's symbol through WorkspaceContext. */
function Widgets({ widgets, start }) {
  const [syms, setSyms] = useState(start)
  groupSyms = syms
  const ref = useRef(null)
  ref.current = setSyms
  const value = useMemo(() => ({ groupSyms: syms, groupTfs: {}, activeWatchlistRef: activeRef, setGroupSym: (c, s) => ref.current(p => ({ ...p, [c]: s })) }), [syms])
  return (
    <MemoryRouter>
      <AuthContext.Provider value={{ user: { id: 1, role: 'admin' } }}>
        <WorkspaceContext.Provider value={value}>
          {widgets.map(w => <div key={w.id} data-testid={`w-${w.id}`}><WatchlistWidget color={w.color} opts={w.opts} onOptsChange={() => {}} /></div>)}
        </WorkspaceContext.Provider>
      </AuthContext.Provider>
    </MemoryRouter>
  )
}

const wl = (id, watchKey, watchName, x = 18, color = 'A', extra = {}) => ({ id, type: 'watchlist', x, y: 0, w: 6, h: 20, color, opts: { watchKey, watchName, ...extra } })
const CHART = chart('c1', 0, 0, 12, 20)
const ON_MOMENTUM = () => [CHART, wl('wl', 'user:w1', 'Momentum')]

/** Open the panel and the real widgets over one fixture server; `sym` = the group symbol. */
function board(widgets = ON_MOMENTUM(), { sym = 'NVDA', lists = LISTS, syncFails = false } = {}) {
  const m = open(widgets, { 'N:c1': 'NVDA' }, { extra: { watchlists: lists } })
  const srv = m.board.state.server
  data.lists = () => srv.lists.map(l => ({ ...l, description: '' }))
  const synced = []
  m.h.flagged = buildFlaggedSource({ request: async (url, init) => {
    synced.push([url, JSON.parse(init.body).symbols])
    return { ok: !m.syncFails, status: m.syncFails ? 500 : 200 }
  } })
  m.syncFails = syncFails
  m.h.listViews = buildListViewSource({ getWidgets: () => m.board.state.widgets })
  const lists_ = widgets.filter(w => w.type === 'watchlist')
  const start = { A: sym, B: sym }
  render(<Widgets widgets={lists_} start={start} />)
  return { ...m, srv, synced, get syncFails() { return m.syncFails }, set syncFails(v) { m.syncFails = v } }
}

const rowsOf = (id = 'wl') => [...document.querySelector(`[data-testid="w-${id}"]`).querySelectorAll('[data-watch-sym]')].map(e => e.getAttribute('data-watch-sym'))
const headers = (id = 'wl') => [...document.querySelector(`[data-testid="w-${id}"]`).querySelectorAll('[aria-label^="Sort by"]')].map(e => e.textContent)
const cols = () => JSON.parse(localStorage.getItem(COLS) || 'null')
const flags = () => JSON.parse(localStorage.getItem(FLAGGED) || '[]')
const server = (m, name) => m.srv.lists.find(l => l.name === name)?.items.map(i => i.sym) ?? null

const views = (c) => must(c.listViews, 'listViews section')
const only = (c) => { const v = views(c); if (v.length !== 1) throw new Error('more than one list on the board'); return v[0].ref }
const activeView = (c) => must(views(c).find(v => v.active), 'active list').ref
const viewOfList = (c, name) => must(views(c).find(v => v.name === name && v.savedList), `widget for ${name}`).ref
const recentList = (c) => must((c.watchlists || []).find(l => l.recent), 'list marked recent')
const flagRef = (c) => must(c.flagged?.[0]?.ref, 'flagged entry')
const listRef = (c, name) => must((c.watchlists || []).find(l => l.name === name), `watchlist ${name}`).ref
const op = (action, target, args) => ({ action, target, args })

beforeEach(() => {
  localStorage.removeItem(COLS)
  localStorage.removeItem(FLAGGED)
  activeRef = { current: null }
  data.prices = PRICES
  data.meta = META
})
afterEach(() => { afterEachOutcome(); cleanup() })

describe('1. sort a widget by a column: the rows on screen change, and Undo puts them back', () => {
  it.each([
    ['sort my watchlist by RVOL', 'RVOL'],
    ['rank this list by relative volume', 'relative volume'],
    ['which names are most active, put them on top', 'rvol'],
    ['order Momentum by rvol, biggest first', 'Relative Volume'],
  ])('"%s"', async (text, column) => {
    const m = board()
    expect(rowsOf()).toEqual(SAVED)
    await m.say(text, (c) => [op('watchlist.sortColumn', only(c), { column, direction: null })])
    await waitFor(() => expect(rowsOf()).toEqual(RVOL_ORDER))
    expect(cols().sort).toEqual({ key: 'rvol', dir: 'desc' })
    expect(headers()).toContain('RVOL')                                  // it was not showing: it joined, as the receipt says
    expect(m.lastReceipt().textContent).toMatch(/Added the RVOL column and sorted “Momentum” by RVOL, high to low/)
    expect(server(m, 'Momentum')).toEqual(SAVED)                         // the view, never the saved order
    await m.say('undo')
    await waitFor(() => expect(rowsOf()).toEqual(SAVED))
    expect(headers()).not.toContain('RVOL')
  })
  it('a column already showing is just sorted; both directions; a text column; the header\'s own first click when none is said', async () => {
    const m = board()
    await m.say('sort by price, lowest first', (c) => [op('watchlist.sortColumn', only(c), { column: 'price', direction: 'asc' })])
    await waitFor(() => expect(rowsOf()).toEqual(['NVDA', 'AAPL', 'AMD', 'TSLA', 'MSFT']))
    expect(m.lastReceipt().textContent).toMatch(/Sorted “Momentum” by Price, low to high/)
    expect(m.lastReceipt().textContent).not.toMatch(/Added/)
    await m.say('flip it', (c) => [op('watchlist.sortColumn', only(c), { column: 'Price', direction: 'descending' })])
    await waitFor(() => expect(rowsOf()).toEqual(['MSFT', 'TSLA', 'AMD', 'AAPL', 'NVDA']))
    await m.say('sort by ticker', (c) => [op('watchlist.sortColumn', only(c), { column: 'ticker', direction: null })])
    await waitFor(() => expect(rowsOf()).toEqual(['AAPL', 'AMD', 'MSFT', 'NVDA', 'TSLA']))
    expect(m.lastReceipt().textContent).toMatch(/by Symbol, A to Z/)
  })
  it('"go back to the saved order" clears the sort', async () => {
    const m = board()
    await m.say('sort by price', (c) => [op('watchlist.sortColumn', only(c), { column: 'price', direction: 'desc' })])
    await waitFor(() => expect(rowsOf()[0]).toBe('MSFT'))
    await m.say('put it back in my order', (c) => [op('watchlist.sortColumn', only(c), { column: null, direction: null })])
    await waitFor(() => expect(rowsOf()).toEqual(SAVED))
    expect(m.lastReceipt().textContent).toMatch(/“Momentum” is back in its saved order/)
    expect(cols().sort).toBe(null)
  })
  it('asking for the sort it already has changes nothing and says so', async () => {
    const m = board()
    await m.say('sort by price', (c) => [op('watchlist.sortColumn', only(c), { column: 'price', direction: 'desc' })])
    await waitFor(() => expect(rowsOf()[0]).toBe('MSFT'))
    const n = JSON.stringify(cols())
    const out = await m.say('sort by price', (c) => [op('watchlist.sortColumn', only(c), { column: 'price', direction: 'desc' })])
    expect(out).toMatch(/already sorted by Price, high to low/)
    expect(JSON.stringify(cols())).toBe(n)
  })
  it.each(['Beta', 'P/E', 'ADR', 'flag'])('a column that does not exist (%s) is refused, naming what exists, and nothing moves', async (column) => {
    const m = board()
    const out = await m.say(`sort by ${column}`, (c) => [op('watchlist.sortColumn', only(c), { column, direction: 'desc' })])
    expect(out).toMatch(/isn't a column here/)
    expect(out).toMatch(/RVOL/)
    expect(rowsOf()).toEqual(SAVED)
    expect(cols()).toBe(null)
  })
  it('no widget shows a list: there is nothing to sort, the request says so by having no entry, and a stale ref is refused', async () => {
    const m = board([CHART])
    const out = await m.say('sort my watchlist by price', (c) => {
      expect(c.listViews).toBeUndefined()
      return [op('watchlist.sortColumn', 'nowhere', { column: 'price', direction: 'desc' })]
    })
    expect(out).toMatch(/not on the workspace/)
  })
  it('a PREBUILT list sorts for now, and the receipt says it will not stay', async () => {
    const widgets = [CHART, wl('wl', 'user:w1', 'Momentum', 18, 'A', { watchTab: 'prebuilt' })]
    const m = board(widgets)
    await m.say('sort by price', (c) => [op('watchlist.sortColumn', only(c), { column: 'price', direction: 'desc' })])
    await waitFor(() => expect(rowsOf()[0]).toBe('MSFT'))
    expect(m.lastReceipt().textContent).toMatch(/goes back to its default columns when reopened/)
    expect(cols()).toBe(null)
  })
})

describe('"this list", "my watchlist", "the one I just made"', () => {
  const TWO = () => [CHART, wl('wl', 'user:w1', 'Momentum'), wl('wl2', 'user:w2', 'Earnings', 12, 'B')]
  it('"this list" with two on the board = the widget the member is in (the one that owns the arrow keys)', async () => {
    const m = board(TWO())
    fireEvent.pointerDown(document.querySelector('[data-testid="w-wl2"] [data-watch-sym]'))      // the member clicks into that widget
    await m.say('sort this list by price', (c) => {
      expect(views(c).filter(v => v.active).map(v => v.name)).toEqual(['Earnings'])
      return [op('watchlist.sortColumn', activeView(c), { column: 'price', direction: 'desc' })]
    })
    await waitFor(() => expect(rowsOf('wl2')).toEqual(['ADBE', 'CRM']))
    expect(rowsOf('wl')).toEqual(SAVED)
  })
  it('by name: the widget whose savedList is that list', async () => {
    const m = board(TWO())
    await m.say('sort my Earnings list by price', (c) => [op('watchlist.sortColumn', viewOfList(c, 'Earnings'), { column: 'price', direction: 'desc' })])
    await waitFor(() => expect(rowsOf('wl2')).toEqual(['ADBE', 'CRM']))
    expect(rowsOf('wl')).toEqual(SAVED)
  })
  it('"the one I just made" is marked recent on the list itself, not left to a receipt, and only that one', async () => {
    const m = board()
    await m.say('create a list called Growth with NVDA', (c) => {
      expect((c.watchlists || []).filter(l => l.recent)).toEqual([])
      return [op('watchlist.create', must(c.watchlistLibrary?.[0]?.ref, 'library'), { name: 'Growth', as: 'n1' }), op('watchlist.add', 'n1', { symbols: ['NVDA'] })]
    })
    await m.apply()
    await waitFor(() => expect(server(m, 'Growth')).toEqual(['NVDA']))
    await m.say('add AMD to the one I just made', (c) => {
      expect(c.watchlists.filter(l => l.recent).map(l => l.name)).toEqual(['Growth'])
      return [op('watchlist.add', recentList(c).ref, { symbols: ['AMD'] })]
    })
    await waitFor(() => expect(server(m, 'Growth')).toEqual(['NVDA', 'AMD']))
    await m.say('rename the one I just made to Leaders', (c) => [op('watchlist.rename', recentList(c).ref, { name: 'Leaders' })])
    await m.apply()
    await waitFor(() => expect(server(m, 'Leaders')).toEqual(['NVDA', 'AMD']))
    await m.say('delete that one', (c) => [op('watchlist.delete', recentList(c).ref, {})])
    await m.apply()
    await waitFor(() => expect(server(m, 'Leaders')).toBe(null))
    await m.say('what do I have', (c) => { expect(c.watchlists.filter(l => l.recent)).toEqual([]); return [op('watchlist.list', must(c.watchlistLibrary?.[0]?.ref, 'library'), {})] })
  })
})

describe('2. add and hide columns: the header changes', () => {
  it.each([
    ['add the market cap column', ['market cap'], 'Market Cap'],
    ['show me RVOL too', ['RVOL'], 'RVOL'],
    ['put next earnings on there', ['Next Earnings'], 'Next Earnings'],
    ['I want sector', ['sector'], 'Sector'],
  ])('"%s"', async (text, add) => {
    const m = board()
    await m.say(text, (c) => [op('watchlist.setColumns', only(c), { add, hide: [], reset: false })])
    await waitFor(() => expect(headers().length).toBe(5))
    expect(cols().order.length).toBe(6)
    expect(m.lastReceipt().textContent).toMatch(/Added .+ to “Momentum”/)
    await m.say('undo')
    await waitFor(() => expect(headers().length).toBe(4))
  })
  it('several at once, and a swap in one request, as one Undo', async () => {
    const m = board()
    await m.say('swap volume for RVOL and add sector', (c) => [op('watchlist.setColumns', only(c), { add: ['RVOL', 'sector'], hide: ['Volume'], reset: false })])
    await waitFor(() => expect(cols().hidden.vol).toBe(true))
    await waitFor(() => expect(cols().order).toEqual(expect.arrayContaining(['rvol', 'sector'])))
    expect(m.lastReceipt().textContent).toMatch(/Added RVOL and Sector to “Momentum” · Hid Volume on “Momentum”/)
    await m.say('undo')
    await waitFor(() => expect(cols()).toEqual({}))
  })
  it.each([
    ['sort by price', 'watchlist.sortColumn', { column: 'price', direction: null }],
    ['sort this by price', 'watchlist.sortColumn', { column: 'price', direction: null }],
    ['rank by price', 'watchlist.sortColumn', { column: 'price', direction: null }],
    ['sorted by % change', 'watchlist.sortColumn', { column: '% change', direction: null }],
    ['sort by volume', 'watchlist.sortColumn', { column: 'volume', direction: null }],
    ['sort by market cap', 'watchlist.sortColumn', { column: 'market cap', direction: null }],
    ['hide price', 'watchlist.setColumns', { add: [], hide: ['price'], reset: false }],
    ['hide the price column', 'watchlist.setColumns', { add: [], hide: ['price'], reset: false }],
    ['remove the price column', 'watchlist.setColumns', { add: [], hide: ['price'], reset: false }],
    ['take the volume column off', 'watchlist.setColumns', { add: [], hide: ['volume'], reset: false }],
    ['show the rvol column', 'watchlist.setColumns', { add: ['rvol'], hide: [], reset: false }],
    ['add the dollar volume column', 'watchlist.setColumns', { add: ['dollar volume'], hide: [], reset: false }],
    ['sort by price, highest first', 'watchlist.sortColumn', { column: 'price', direction: 'desc' }],
    ['sort by price descending', 'watchlist.sortColumn', { column: 'price', direction: 'desc' }],
    ['sort by price high to low', 'watchlist.sortColumn', { column: 'price', direction: 'desc' }],
    ['next', 'watchlist.step', { direction: 'next', by: null }],
    ['previous', 'watchlist.step', { direction: 'previous', by: null }],
    ['next ticker in the list', 'watchlist.step', { direction: 'next', by: null }],
    ['next stock', 'watchlist.step', { direction: 'next', by: null }],
    ['go to the next name', 'watchlist.step', { direction: 'next', by: null }],
    ['previous ticker', 'watchlist.step', { direction: 'previous', by: null }],
    ['back one', 'watchlist.step', { direction: 'previous', by: null }],
  ])('"%s" reaches the planner: no reader answers it first', async (text, action, args) => {
    const m = board()
    let asked = false
    await m.say(text, (c) => { asked = true; return [op(action, only(c), args)] })
    expect(asked).toBe(true)
    expect(m.lastReceipt()).not.toBe(null)
  })
  it('hide a default column and an added one; the column menu reads the same state', async () => {
    const m = board()
    await m.say('add rvol', (c) => [op('watchlist.setColumns', only(c), { add: ['rvol'], hide: [], reset: false })])
    await waitFor(() => expect(cols().order).toContain('rvol'))
    await m.say('hide rvol and price', (c) => [op('watchlist.setColumns', only(c), { add: [], hide: ['rvol', 'price'], reset: false })])
    await waitFor(() => expect(cols().order).not.toContain('rvol'))
    expect(cols().hidden.price).toBe(true)
    await waitFor(() => expect(headers()).toHaveLength(3))                // Symbol, Volume, % Change
  })
  it('hiding the column it is sorted by drops the sort, and says so: a hidden column orders nothing', async () => {
    const m = board()
    await m.say('sort by rvol', (c) => [op('watchlist.sortColumn', only(c), { column: 'rvol', direction: 'desc' })])
    await waitFor(() => expect(rowsOf()).toEqual(RVOL_ORDER))
    await m.say('hide rvol', (c) => [op('watchlist.setColumns', only(c), { add: [], hide: ['rvol'], reset: false })])
    await waitFor(() => expect(rowsOf()).toEqual(SAVED))
    expect(m.lastReceipt().textContent).toMatch(/no longer sorted by that column/)
    await m.say('undo')
    await waitFor(() => expect(rowsOf()).toEqual(RVOL_ORDER))
  })
  it('reset goes to the defaults, and Undo brings the custom columns back', async () => {
    const m = board()
    await m.say('add rvol and hide volume', (c) => [op('watchlist.setColumns', only(c), { add: ['rvol'], hide: ['vol'], reset: false })])
    await waitFor(() => expect(cols().hidden.vol).toBe(true))
    const custom = cols()
    await m.say('reset my columns', (c) => [op('watchlist.setColumns', only(c), { add: [], hide: [], reset: true })])
    await waitFor(() => expect(cols()).toEqual({}))
    expect(m.lastReceipt().textContent).toMatch(/Reset the columns on “Momentum”/)
    await m.say('undo')
    await waitFor(() => expect(cols()).toEqual(custom))
  })
  it.each([
    [{ add: ['ADR'], hide: [], reset: false }, /“ADR” isn't a column here/],
    [{ add: ['RVOL', 'Beta'], hide: [], reset: false }, /“Beta” isn't a column here/],
    [{ add: [], hide: ['Symbol'], reset: false }, /Symbol can't be hidden/],
    [{ add: ['rvol'], hide: ['RVOL'], reset: false }, /Show RVOL, or hide it/],
    [{ add: [], hide: [], reset: false }, /Which columns/],
  ])('refused, nothing written: %j', async (args, why) => {
    const m = board()
    const out = await m.say('change the columns', (c) => [op('watchlist.setColumns', only(c), args)])
    expect(out).toMatch(why)
    expect(cols()).toBe(null)
  })
  it('a column already showing, or already at defaults, is a no-op said as one', async () => {
    const m = board()
    expect(await m.say('show price', (c) => [op('watchlist.setColumns', only(c), { add: ['price'], hide: [], reset: false })])).toMatch(/already shows Price/)
    expect(await m.say('reset columns', (c) => [op('watchlist.setColumns', only(c), { add: [], hide: [], reset: true })])).toMatch(/already the defaults/)
    expect(cols()).toBe(null)
  })
})

describe('3. flag and unflag: the star a member sees, the store and the server', () => {
  const star = (sym) => document.querySelector(`[data-watch-sym="${sym}"] [aria-pressed="true"], [data-watch-sym="${sym}"] [title^="Remove from Flagged"]`)
  it.each([
    ['flag NVDA', ['NVDA']], ['star AMD and TSLA', ['AMD', 'TSLA']], ['mark nvda', ['nvda']], ['add MSFT to my flagged list', ['$MSFT']],
  ])('"%s"', async (text, symbols) => {
    const m = board()
    await m.say(text, (c) => [op('watchlist.setFlag', flagRef(c), { symbols, flagged: true })])
    const want = symbols.map(s => s.replace('$', '').toUpperCase())
    await waitFor(() => expect(flags()).toEqual(want))
    expect(m.synced.at(-1)).toEqual(['/api/watchlists/flagged/sync', want])
    expect(m.lastReceipt().textContent).toMatch(/Flagged /)
    await m.say('undo')
    await waitFor(() => expect(flags()).toEqual([]))
    expect(m.synced.at(-1)).toEqual(['/api/watchlists/flagged/sync', []])
  })
  it('the row star follows, without a reload (the same store and event a click uses)', async () => {
    const m = board()
    await m.say('flag NVDA', (c) => [op('watchlist.setFlag', flagRef(c), { symbols: ['NVDA'], flagged: true })])
    await waitFor(() => expect(star('NVDA')).not.toBe(null))
    expect(star('TSLA')).toBe(null)
  })
  it('unflag keeps the rest; Undo puts it back in its place; flags set by hand since do not cost that Undo', async () => {
    const m = board()
    writeFlagged(['AMD', 'TSLA', 'NVDA'])
    await m.say('unflag TSLA', (c) => {
      expect(c.flagged[0].symbols).toEqual(['AMD', 'TSLA', 'NVDA'])
      return [op('watchlist.setFlag', flagRef(c), { symbols: ['TSLA'], flagged: false })]
    })
    await waitFor(() => expect(flags()).toEqual(['AMD', 'NVDA']))
    expect(m.lastReceipt().textContent).toMatch(/Unflagged TSLA/)
    await m.say('undo')
    await waitFor(() => expect(flags()).toEqual(['AMD', 'TSLA', 'NVDA']))
    await m.say('unflag AMD', (c) => [op('watchlist.setFlag', flagRef(c), { symbols: ['AMD'], flagged: false })])
    await waitFor(() => expect(flags()).toEqual(['TSLA', 'NVDA']))
    writeFlagged(['TSLA', 'NVDA', 'CRM'])
    await m.say('undo')
    await waitFor(() => expect(flags()).toEqual(['TSLA', 'NVDA', 'CRM', 'AMD']))
  })
  it('flag some already flagged: only the new one, and it says which; all already: a no-op, nothing posted', async () => {
    const m = board()
    writeFlagged(['NVDA'])
    await m.say('flag NVDA and AMD', (c) => [op('watchlist.setFlag', flagRef(c), { symbols: ['NVDA', 'AMD'], flagged: true })])
    await waitFor(() => expect(flags()).toEqual(['NVDA', 'AMD']))
    expect(m.lastReceipt().textContent).toMatch(/Flagged AMD · NVDA was already flagged/)
    const n = m.synced.length
    expect(await m.say('flag NVDA', (c) => [op('watchlist.setFlag', flagRef(c), { symbols: ['NVDA'], flagged: true })])).toMatch(/already flagged/)
    expect(await m.say('unflag CRM', (c) => [op('watchlist.setFlag', flagRef(c), { symbols: ['CRM'], flagged: false })])).toMatch(/isn't flagged/)
    expect(m.synced.length).toBe(n)
  })
  it('a ticker UCT does not know refuses the whole flag, and no tickers refuses', async () => {
    const m = board()
    const base = globalThis.fetch
    globalThis.fetch = async (u, i) => (/ticker-search\?q=QQQQX/i.test(String(u)) ? new Response('{"results":[]}', { status: 200 }) : base(u, i))
    await m.say('flag AMD and QQQQX', (c) => [op('watchlist.setFlag', flagRef(c), { symbols: ['AMD', 'QQQQX'], flagged: true })])
    expect(m.p.transcript()).toMatch(/QQQQX/)
    expect(flags()).toEqual([])
    expect(await m.say('flag', (c) => [op('watchlist.setFlag', flagRef(c), { symbols: [], flagged: true })])).toMatch(/Which tickers/)
  })
  it('the server refuses: the flag is taken back, and nothing claims it landed', async () => {
    const m = board()
    m.syncFails = true
    await m.say('flag NVDA', (c) => [op('watchlist.setFlag', flagRef(c), { symbols: ['NVDA'], flagged: true })])
    await waitFor(() => expect(m.synced.length).toBe(1))
    await waitFor(() => expect(flags()).toEqual([]))
    expect(m.p.summaries().join(' ')).not.toMatch(/^Flagged NVDA/)
    expect(m.p.transcript()).toMatch(/saving the flags failed/)
  })
  it('more than ten is proposed first', async () => {
    const m = board()
    const symbols = ['NVDA', 'TSLA', 'AMD', 'AAPL', 'MSFT', 'CRM', 'ADBE', 'INTC', 'ORCL', 'SHOP', 'UBER']
    await m.say('flag all of these', (c) => [op('watchlist.setFlag', flagRef(c), { symbols, flagged: true })])
    expect(proposalsNow()).toHaveLength(1)
    expect(flags()).toEqual([])
    await m.apply()
    await waitFor(() => expect(flags()).toHaveLength(11))
    expect(m.lastReceipt().textContent).toMatch(/Flagged 11 stocks/)
  })
})

describe('4. next and previous: in the order on screen, the arrow keys\' walk', () => {
  const STEP = (direction, by = null) => (c) => [op('watchlist.step', only(c), { direction, by })]
  const selected = () => groupSyms.A
  it.each([
    ['next ticker', 'next', null, 'TSLA'], ['next one', 'next', null, 'TSLA'], ['go down one', 'down', null, 'TSLA'],
    ['skip two', 'next', 3, 'AAPL'], ['last name on the list', 'last', null, 'MSFT'], ['back to the top', 'first', null, 'NVDA'],
  ])('"%s"', async (text, direction, by, want) => {
    const m = board(ON_MOMENTUM(), { sym: direction === 'first' ? 'AMD' : 'NVDA' })
    const from = selected()
    await m.say(text, STEP(direction, by))
    await waitFor(() => expect(selected()).toBe(want))
    expect(m.lastReceipt().textContent).toContain(`${want} in “Momentum” (from ${from}`)
    await m.say('undo')
    await waitFor(() => expect(selected()).toBe(from))
  })
  it('previous, and both ends wrap as the keys do, and the receipt says it wrapped', async () => {
    const m = board(ON_MOMENTUM(), { sym: 'NVDA' })
    await m.say('previous ticker', STEP('previous'))
    await waitFor(() => expect(selected()).toBe('MSFT'))
    expect(m.lastReceipt().textContent).toMatch(/wrapped around/)
    await m.say('next', STEP('next'))
    await waitFor(() => expect(selected()).toBe('NVDA'))
    expect(m.lastReceipt().textContent).toMatch(/wrapped around/)
  })
  it('walks the SORTED order, not the saved one', async () => {
    const m = board(ON_MOMENTUM(), { sym: 'TSLA' })
    await m.say('sort by rvol', (c) => [op('watchlist.sortColumn', only(c), { column: 'rvol', direction: 'desc' })])
    await waitFor(() => expect(rowsOf()).toEqual(RVOL_ORDER))
    await m.say('next', STEP('next'))
    await waitFor(() => expect(selected()).toBe('AAPL'))
  })
  it('nothing selected starts where the keys start', async () => {
    const m = board(ON_MOMENTUM(), { sym: null })
    await m.say('next', STEP('next'))
    await waitFor(() => expect(selected()).toBe('NVDA'))
    expect(m.lastReceipt().getAttribute('data-undoable')).not.toBe('true')
  })
  it('the chart is on a name outside the list: refused, naming it, nothing moves; "first" still works', async () => {
    const m = board(ON_MOMENTUM(), { sym: 'ZZZZ' })
    expect(await m.say('next ticker', STEP('next'))).toMatch(/linked chart is on ZZZZ, which isn't in “Momentum”/)
    expect(selected()).toBe('ZZZZ')
    await m.say('go to the first one', STEP('first'))
    await waitFor(() => expect(selected()).toBe('NVDA'))
  })
  it('an empty list is refused', async () => {
    const m = board([CHART, wl('wl', 'user:w1', 'Momentum')], { lists: [{ id: 'w1', name: 'Momentum', symbols: [] }] })
    expect(await m.say('next', STEP('next'))).toMatch(/no tickers showing/)
  })
  it('a step past the list is refused; "first" while on the first is a no-op', async () => {
    const m = board(ON_MOMENTUM())
    expect(await m.say('skip ninety', STEP('next', 90))).toMatch(/move 1 to 5/)
    expect(await m.say('the first one', STEP('first'))).toMatch(/already the first name/)
    expect(selected()).toBe('NVDA')
  })
  it('a one-row list has nowhere to go, and says so', async () => {
    const m = board([CHART, wl('wl', 'user:w1', 'Momentum')], { lists: [{ id: 'w1', name: 'Momentum', symbols: ['NVDA'] }] })
    expect(await m.say('next', STEP('next'))).toMatch(/only name in/)
  })
})

describe('5. several at once, including everything except these', () => {
  const KEEP = (symbols) => (c) => [op('watchlist.keepOnly', listRef(c, 'Momentum'), { symbols })]
  it.each([
    ['remove everything except NVDA and AMD', ['NVDA', 'AMD']], ['keep only nvda, amd', ['nvda', 'amd']], ['drop all but NVDA and AMD from this list', ['$NVDA', 'AMD']],
  ])('"%s": one proposal naming what goes; Dismiss keeps; Apply removes; one Undo restores notes and order', async (text, symbols) => {
    const m = board()
    await m.say(text, KEEP(symbols))
    expect(proposalsNow()).toHaveLength(1)
    expect(proposalsNow()[0].textContent).toMatch(/TSLA, AAPL and MSFT/)
    await m.dismiss()
    expect(server(m, 'Momentum')).toEqual(SAVED)
    await m.say(text, KEEP(symbols))
    await m.apply()
    await waitFor(() => expect(server(m, 'Momentum')).toEqual(['NVDA', 'AMD']))
    expect(m.lastReceipt().textContent).toMatch(/Removed TSLA, AAPL and MSFT from “Momentum”, keeping NVDA and AMD/)
    await m.say('undo')
    await waitFor(() => expect(server(m, 'Momentum')).toEqual(SAVED))
    expect(m.srv.lists[0].items.find(i => i.sym === 'TSLA').notes).toBe('a note that must survive')
  })
  it('a name not in the list stops the whole change; so does none; keeping everything is a no-op', async () => {
    const m = board()
    expect(await m.say('keep only NVDA and QQQ', KEEP(['NVDA', 'QQQ']))).toMatch(/QQQ isn't in “Momentum”, so nothing was removed/)
    expect(await m.say('keep nothing', KEEP([]))).toMatch(/Which tickers stay/)
    expect(await m.say('keep them all', KEEP(SAVED))).toMatch(/only holds those already/)
    expect(m.pending()).toBe(0)
    expect(server(m, 'Momentum')).toEqual(SAVED)
  })
  it('a server failure halfway puts back what was removed and claims nothing', async () => {
    const m = board()
    let n = 0
    m.srv.failOn = (method) => method === 'DELETE' && ++n === 2
    await m.say('keep only NVDA', KEEP(['NVDA']))
    await m.apply()
    await waitFor(() => expect(n).toBeGreaterThanOrEqual(2))
    await waitFor(() => expect([...server(m, 'Momentum')].sort()).toEqual([...SAVED].sort()))
    expect(m.p.summaries().join(' ')).not.toMatch(/Removed/)
  })
  it('a linked list stays read-only', async () => {
    const m = board(ON_MOMENTUM(), { lists: [{ id: 'w1', name: 'Momentum', symbols: SAVED, origin: { mode: 'link' } }] })
    expect(await m.say('keep only NVDA', KEEP(['NVDA']))).toMatch(/can't be edited here/)
  })
  it('several named tickers go at once without a proposal when few and not all; Undo restores', async () => {
    const m = board()
    await m.say('remove TSLA and AMD from Momentum', (c) => [op('watchlist.remove', listRef(c, 'Momentum'), { symbols: ['TSLA', 'AMD'] })])
    await waitFor(() => expect(server(m, 'Momentum')).toEqual(['NVDA', 'AAPL', 'MSFT']))
    expect(m.pending()).toBe(0)
    await m.say('undo')
    await waitFor(() => expect(server(m, 'Momentum')).toEqual(SAVED))
  })
  it('listing EVERY ticker is a clear by another name, so it is proposed', async () => {
    const m = board()
    await m.say('remove all five', (c) => [op('watchlist.remove', listRef(c, 'Momentum'), { symbols: SAVED })])
    expect(proposalsNow()).toHaveLength(1)
    expect(server(m, 'Momentum')).toEqual(SAVED)
    await m.apply()
    await waitFor(() => expect(server(m, 'Momentum')).toEqual([]))
    await m.say('undo')
    await waitFor(() => expect(server(m, 'Momentum')).toEqual(SAVED))
  })
  it('more than ten at once is proposed', async () => {
    const big = Array.from({ length: 14 }, (_, i) => `T${i}`)
    const m = board(ON_MOMENTUM(), { lists: [{ id: 'w1', name: 'Momentum', symbols: big }] })
    await m.say('remove twelve', (c) => [op('watchlist.remove', listRef(c, 'Momentum'), { symbols: big.slice(0, 12) })])
    expect(proposalsNow()).toHaveLength(1)
    expect(server(m, 'Momentum')).toEqual(big)
  })
  it('a list too big to take apart at once is refused and says where', async () => {
    const big = Array.from({ length: 60 }, (_, i) => `T${i}`)
    const m = board(ON_MOMENTUM(), { lists: [{ id: 'w1', name: 'Momentum', symbols: big }] })
    expect(await m.say('keep only T1', KEEP(['T1']))).toMatch(/more than I remove at once/)
    expect(server(m, 'Momentum')).toEqual(big)
  })
})

describe('7. what a list shows, so a follow-up can act on "the top three"', () => {
  const sortRvol = (m) => m.say('sort by rvol', (c) => [op('watchlist.sortColumn', only(c), { column: 'rvol', direction: 'desc' })])
  const top = (c, n) => views(c)[0].rows.slice(0, n)
  it('the request carries the rows as drawn, the sort and the columns; the answer reads the same, with no prices', async () => {
    const m = board()
    await sortRvol(m)
    await waitFor(() => expect(rowsOf()).toEqual(RVOL_ORDER))
    const out = await m.say('what\'s at the top of this list', (c) => {
      expect(views(c)[0]).toMatchObject({ name: 'Momentum', count: 5, rows: RVOL_ORDER, on: 'NVDA', order: 'sorted by RVOL, high to low' })
      return [op('watchlist.readView', only(c), { as: null })]
    })
    expect(out).toContain(`“Momentum” (5, sorted by RVOL, high to low): ${RVOL_ORDER.join(', ')}`)
    expect(out).not.toMatch(/\$\d/)
  })
  it('"remove the top three": the three on SCREEN, not the first three saved', async () => {
    const m = board()
    await sortRvol(m)
    await waitFor(() => expect(rowsOf()).toEqual(RVOL_ORDER))
    await m.say('remove the top three', (c) => [op('watchlist.remove', listRef(c, 'Momentum'), { symbols: top(c, 3) })])
    await waitFor(() => expect(server(m, 'Momentum')).toEqual(['NVDA', 'AMD']))
  })
  it('"flag the top two" and "keep the top two"', async () => {
    const m = board()
    await sortRvol(m)
    await waitFor(() => expect(rowsOf()).toEqual(RVOL_ORDER))
    await m.say('flag the top two', (c) => [op('watchlist.setFlag', flagRef(c), { symbols: top(c, 2), flagged: true })])
    await waitFor(() => expect(flags()).toEqual(['TSLA', 'AAPL']))
    await m.say('keep only the top two', (c) => [op('watchlist.keepOnly', listRef(c, 'Momentum'), { symbols: top(c, 2) })])
    await m.apply()
    await waitFor(() => expect([...server(m, 'Momentum')].sort()).toEqual(['AAPL', 'TSLA']))
  })
  it('"add the top two of this list to Earnings" in one request: read at apply, in the on-screen order', async () => {
    const m = board()
    await sortRvol(m)
    await waitFor(() => expect(rowsOf()).toEqual(RVOL_ORDER))
    await m.say('add the top two of this list to Earnings', (c) => [op('watchlist.readView', only(c), { as: 'view1' }), op('watchlist.add', listRef(c, 'Earnings'), { symbols: { from: 'view1', top: 2 } })])
    if (m.pending()) await m.apply()
    await waitFor(() => expect(server(m, 'Earnings')).toEqual(['CRM', 'ADBE', 'TSLA', 'AAPL']))
  })
  it('a saved-order change on a column-sorted widget says it will not show', async () => {
    const m = board()
    await sortRvol(m)
    await waitFor(() => expect(rowsOf()).toEqual(RVOL_ORDER))
    await m.say('sort Momentum a to z', (c) => [op('watchlist.reorder', listRef(c, 'Momentum'), { sort: 'az', top: [] })])
    await waitFor(() => expect(server(m, 'Momentum')).toEqual(['AAPL', 'AMD', 'MSFT', 'NVDA', 'TSLA']))
    expect(m.lastReceipt().textContent).toMatch(/won't show this order until that sort is cleared/)
    expect(rowsOf()).toEqual(RVOL_ORDER)
  })
  it('a long list gives the model the first rows and says how many more', async () => {
    const big = Array.from({ length: 45 }, (_, i) => `T${i}`)
    const m = board(ON_MOMENTUM(), { lists: [{ id: 'w1', name: 'Momentum', symbols: big }] })
    await m.say('how long is it', (c) => {
      expect(views(c)[0]).toMatchObject({ count: 45, moreRows: 5 })
      expect(views(c)[0].rows).toHaveLength(40)
      return [op('watchlist.readView', only(c), { as: null })]
    })
  })
})

describe('the other lists a widget can show', () => {
  const Scan = () => {
    const [sym, setSym] = useState('NVDA')
    const ctx = useMemo(() => ({ sym, setSym, tf: 'D' }), [sym])
    return (
      <MemoryRouter>
        <AuthContext.Provider value={{ user: { id: 1, role: 'admin' } }}>
          <ChartsSymContext.Provider value={ctx}>
            <div data-testid="w-scan">
              <Watchlists embedded pickList="__scan__" pickName="Highest Volume" scanSymbols={['NVDA', 'TSLA', 'AMD']} colStorageKey={`${COLS}.scanner.hv`} listView={{ type: 'scanner', color: 'A', key: 'hv' }} />
            </div>
          </ChartsSymContext.Provider>
        </AuthContext.Provider>
      </MemoryRouter>
    )
  }
  const scanBoard = () => {
    const m = board([CHART, { id: 'sc', type: 'scanner', x: 12, y: 0, w: 12, h: 20, color: 'A', opts: { scanKey: 'hv', scanName: 'Highest Volume' } }])
    render(<Scan />)
    return m
  }
  it('a Scanner: sorts and reads the same way, and its columns stay its own, not the watchlists\'', async () => {
    const m = scanBoard()
    await m.say('sort this scan by price', (c) => {
      expect(views(c)[0]).toMatchObject({ widget: 'scanner', name: 'Highest Volume', rows: ['NVDA', 'TSLA', 'AMD'] })
      expect(views(c)[0].savedList).toBeUndefined()
      return [op('watchlist.sortColumn', only(c), { column: 'price', direction: 'desc' })]
    })
    await waitFor(() => expect(m.h.listViews.snapshot()[0].rows).toEqual(['TSLA', 'AMD', 'NVDA']))      // a scan draws through the virtualizer, which jsdom does not lay out: its published order is what the panel reads
    expect(JSON.parse(localStorage.getItem(`${COLS}.scanner.hv`)).sort).toEqual({ key: 'price', dir: 'desc' })
    expect(cols()).toBe(null)
    await m.say('add sector to this scan', (c) => [op('watchlist.setColumns', only(c), { add: ['sector'], hide: [], reset: false })])
    await waitFor(() => expect(JSON.parse(localStorage.getItem(`${COLS}.scanner.hv`)).order).toContain('sector'))
    const out = await m.say('top of the scan', (c) => [op('watchlist.readView', only(c), { as: null })])
    expect(out).toContain('“Highest Volume” (3, sorted by Price, high to low): TSLA, AMD, NVDA')
  })
  it('"add the top two of this scan to Earnings" feeds a saved list from a widget with no list of its own', async () => {
    const m = scanBoard()
    await m.say('add the top two of this scan to Earnings', (c) => [op('watchlist.readView', only(c), { as: 'scan1' }), op('watchlist.add', listRef(c, 'Earnings'), { symbols: { from: 'scan1', top: 2 } })])
    if (m.pending()) await m.apply()
    await waitFor(() => expect(server(m, 'Earnings')).toEqual(['CRM', 'ADBE', 'NVDA', 'TSLA']))
  })
  it('a Flagged widget: its rows are the flags, and flagging from the Agent shows up in them', async () => {
    const m = board([CHART, wl('wl', 'flagged', 'Flagged')])
    writeFlagged(['NVDA', 'AMD'])
    await waitFor(() => expect(rowsOf()).toEqual(['NVDA', 'AMD']))
    await m.say('flag TSLA', (c) => [op('watchlist.setFlag', flagRef(c), { symbols: ['TSLA'], flagged: true })])
    await waitFor(() => expect(rowsOf()).toEqual(['NVDA', 'AMD', 'TSLA']))
    await m.say('sort this list by price', (c) => {
      expect(views(c)[0].rows).toEqual(['NVDA', 'AMD', 'TSLA'])
      return [op('watchlist.sortColumn', only(c), { column: 'price', direction: 'desc' })]
    })
    await waitFor(() => expect(rowsOf()).toEqual(['TSLA', 'AMD', 'NVDA']))
    await m.say('what does it show', (c) => { expect(views(c)[0].rows).toEqual(['TSLA', 'AMD', 'NVDA']); return [op('watchlist.readView', only(c), { as: null })] })
  })
  it('the same list twice on one board: two targets, each its own', async () => {
    const m = board([CHART, wl('wl', 'user:w1', 'Momentum'), wl('wl2', 'user:w1', 'Momentum', 12, 'A')])
    await m.say('what does it show', (c) => {
      expect(new Set(views(c).map(v => v.ref)).size).toBe(2)
      return [op('watchlist.readView', views(c)[0].ref, { as: null })]
    })
  })
  it('a thematic-index list has fixed columns: refused, nothing written', () => {
    const st = { name: 'Themes', columns: ['flag', 'sym', 'chg'], cfg: {}, fixedColumns: true }
    expect(getCapability('watchlist.setColumns').check(st, { add: ['rvol'], hide: [], reset: false })).toMatch(/fixed columns/)
    expect(getCapability('watchlist.sortColumn').check(st, { column: 'rvol', direction: null })).toMatch(/only has the Symbol and % Change columns/)
  })
})

describe('the member and the Agent on one widget', () => {
  it('a header click after the Agent\'s sort is the same state: the click flips it, and the Agent\'s Undo then refuses rather than overwrite it', async () => {
    const m = board()
    await m.say('sort by price', (c) => [op('watchlist.sortColumn', only(c), { column: 'price', direction: 'desc' })])
    await waitFor(() => expect(rowsOf()[0]).toBe('MSFT'))
    fireEvent.click(document.querySelector('[data-testid="w-wl"] [aria-label="Sort by Price"]'))
    await waitFor(() => expect(cols().sort).toEqual({ key: 'price', dir: 'asc' }))
    await waitFor(() => expect(rowsOf()[0]).toBe('NVDA'))
    const out = await m.say('undo')
    expect(out).not.toMatch(/Undid/)
    expect(cols().sort).toEqual({ key: 'price', dir: 'asc' })
  })
  it('a column the menu added and a column the Agent added are the same thing to the menu', async () => {
    const m = board()
    await m.say('add rvol', (c) => [op('watchlist.setColumns', only(c), { add: ['rvol'], hide: [], reset: false })])
    await waitFor(() => expect(headers()).toContain('RVOL'))
    fireEvent.contextMenu(document.querySelector('[data-testid="w-wl"] [aria-label="Sort by RVOL"]'))
    fireEvent.click(await screen.findByRole('button', { name: 'RVOL' }))
    await waitFor(() => expect(headers()).not.toContain('RVOL'))
    await m.say('what shows', (c) => { expect(views(c)[0].columns).not.toContain('RVOL'); return [op('watchlist.readView', only(c), { as: null })] })
  })
  it('"remove TSLA and AMD from Momentum" needs no model at all (the existing phrase), and the widget\'s rows follow its read', async () => {
    const m = board()
    await m.say('remove TSLA and AMD from Momentum')
    await waitFor(() => expect(server(m, 'Momentum')).toEqual(['NVDA', 'AAPL', 'MSFT']))
    expect(m.p.turns()).toBe(0)
  })
})

describe('the widget unmounting takes its target with it', () => {
  it('nothing stays published once a widget is gone', async () => {
    const m = board()
    expect(m.h.listViews.snapshot()).toHaveLength(1)
    cleanup()
    expect(mountedListViews()).toHaveLength(0)
  })
  it('a plan made while it was there, an Undo after it left: never a write to nothing', async () => {
    const m = board()
    await m.say('sort by price', (c) => [op('watchlist.sortColumn', only(c), { column: 'price', direction: 'desc' })])
    await waitFor(() => expect(rowsOf()[0]).toBe('MSFT'))
    const before = JSON.stringify(cols())
    m.board.state.widgets = m.board.state.widgets.filter(w => w.type !== 'watchlist')
    const out = await m.say('undo')
    expect(out).not.toMatch(/Undid/)
    expect(JSON.stringify(cols())).toBe(before)
  })
})
