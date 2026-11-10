// CHARTS OUTCOME, F6 (AUDIT #1027): the column Undo when no layout was saved. The mount and fixtures are listControl.outcome's,
// copied as they are (the real WatchlistWidget + Watchlists.jsx beside the real Agent panel, the real column writer). Assertions
// read the rows the widget publishes and the storage it persists. The model is scripted (see listControl.outcome).
//
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
function board(widgets = ON_MOMENTUM(), { sym = 'NVDA', lists = LISTS, syncFails = false, savedCols = null } = {}) {
  const m = open(widgets, { 'N:c1': 'NVDA' }, { extra: { watchlists: lists } })
  // open() clears localStorage (panelHarness), so a saved layout is seeded after it and before the widgets mount
  if (savedCols) localStorage.setItem(COLS, JSON.stringify(savedCols))
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

// ── F6 (AUDIT #1027): the column Undo when NOTHING was saved ─────────────────────────────────────────────────────────
// A widget with no saved column layout draws its caller's defaults (none for a saved list; the scanner's own, RVOL-sorted).
// The Agent's change saves one. Its Undo must take that saved layout away again (the storage key is REMOVED, never written
// as `{}` or as a copy of the defaults), so the defaults come back and stay the defaults. A layout that WAS saved is put
// back exactly. Watchlists.jsx's saved-wins rule (a saved layout beats the defaults) is not touched.
const SCAN_KEY = `${COLS}.scanner.hv`
const SCAN_DEFAULTS = { order: ['flag', 'sym', 'price', 'vol', 'chg', 'rvol'], sort: { key: 'rvol', dir: 'desc' } }
const raw = (k) => localStorage.getItem(k)
const Scan = () => {
  const [sym, setSym] = useState('NVDA')
  const ctx = useMemo(() => ({ sym, setSym, tf: 'D' }), [sym])
  return (
    <MemoryRouter>
      <AuthContext.Provider value={{ user: { id: 1, role: 'admin' } }}>
        <ChartsSymContext.Provider value={ctx}>
          <div data-testid="w-scan">
            <Watchlists embedded pickList="__scan__" pickName="Highest Volume" scanSymbols={['NVDA', 'TSLA', 'AMD']} colStorageKey={SCAN_KEY} defaultColCfg={SCAN_DEFAULTS} listView={{ type: 'scanner', color: 'A', key: 'hv' }} />
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
const scanRows = (m) => m.h.listViews.snapshot()[0].rows

describe('F6. the column Undo with no saved layout removes the saved layout, so the defaults come back', () => {
  beforeEach(() => { localStorage.removeItem(SCAN_KEY) })

  it('a Watchlist with nothing saved: sort, then Undo leaves NO saved layout (never `{}`), and the default columns draw', async () => {
    const m = board()
    expect(raw(COLS)).toBe(null)
    await m.say('sort my watchlist by RVOL', (c) => [op('watchlist.sortColumn', only(c), { column: 'rvol', direction: null })])
    await waitFor(() => expect(rowsOf()).toEqual(RVOL_ORDER))
    expect(cols().sort).toEqual({ key: 'rvol', dir: 'desc' })
    await m.say('undo')
    await waitFor(() => expect(rowsOf()).toEqual(SAVED))
    expect(raw(COLS)).toBe(null)
    expect(headers()).not.toContain('RVOL')
  })

  it('a Watchlist with nothing saved: add a column, then Undo leaves NO saved layout', async () => {
    const m = board()
    await m.say('add sector', (c) => [op('watchlist.setColumns', only(c), { add: ['sector'], hide: [], reset: false })])
    await waitFor(() => expect(cols()?.order || []).toContain('sector'))
    await m.say('undo')
    await waitFor(() => expect(raw(COLS)).toBe(null))
  })

  it('a Scanner with nothing saved: sort by price, then Undo removes its layout and its own default (RVOL, high to low) is back', async () => {
    const m = scanBoard()
    await waitFor(() => expect(scanRows(m)).toEqual(['TSLA', 'AMD', 'NVDA']))                // META rvol: TSLA 900, AMD 300, NVDA 150
    await m.say('sort this scan by price', (c) => [op('watchlist.sortColumn', only(c), { column: 'price', direction: 'asc' })])
    await waitFor(() => expect(scanRows(m)).toEqual(['NVDA', 'AMD', 'TSLA']))
    expect(JSON.parse(raw(SCAN_KEY)).sort).toEqual({ key: 'price', dir: 'asc' })
    await m.say('undo')
    await waitFor(() => expect(scanRows(m)).toEqual(['TSLA', 'AMD', 'NVDA']))
    expect(raw(SCAN_KEY)).toBe(null)
    expect(m.h.listViews.snapshot()[0].sort).toEqual({ key: 'rvol', dir: 'desc' })
  })

  it('control: a layout that WAS saved is put back exactly by the Undo', async () => {
    const saved = { order: ['flag', 'sym', 'price', 'vol', 'chg', 'sector'], hidden: { vol: true }, widths: { price: 90 } }
    const m = board(ON_MOMENTUM(), { savedCols: saved })
    expect(raw(COLS)).toBe(JSON.stringify(saved))
    await m.say('sort by price, lowest first', (c) => [op('watchlist.sortColumn', only(c), { column: 'price', direction: 'asc' })])
    await waitFor(() => expect(cols().sort).toEqual({ key: 'price', dir: 'asc' }))
    await m.say('undo')
    await waitFor(() => expect(cols()).toEqual(saved))
    expect(raw(COLS)).toBe(JSON.stringify(saved))
  })
})
