// CHARTS OUTCOME, AUDIT #1027 F1 (b) and (c): which Watchlist widget a widget op acts on, over the REAL widgets. The mount and
// fixtures are listControl.outcome's, copied as they are (the real WatchlistWidget + Watchlists.jsx beside the real Agent panel).
// Written BEFORE the shared which-widget module (agent/whichWidget.js), run red on a7d44da95a. The model is scripted.
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

// ── AUDIT #1027 F1 rails over the REAL Watchlist widgets: (b) u18-look-07 and (c) u18-cols-07 ────────────────────────────────
// Two Watchlist widgets and words that name neither: the member is ASKED, and nothing changes (the plan guessed one). Each widget
// sits in its WidgetDoorContext slot, as on /charts, so its door (the ⚙ panel's own setters) is really there to be used.
const { WidgetDoorContext } = await import('../../../pages/charts/widgetDoors')
function DoorWidgets({ widgets, start }) {
  const [syms, setSyms] = useState(start)
  const ref = useRef(null)
  ref.current = setSyms
  const value = useMemo(() => ({ groupSyms: syms, groupTfs: {}, activeWatchlistRef: activeRef, setGroupSym: (c, s) => ref.current(p => ({ ...p, [c]: s })) }), [syms])
  return (
    <MemoryRouter>
      <AuthContext.Provider value={{ user: { id: 1, role: 'admin' } }}>
        <WorkspaceContext.Provider value={value}>
          {widgets.map(w => <div key={w.id} data-testid={`w-${w.id}`}><WidgetDoorContext.Provider value={w.id}><WatchlistWidget color={w.color} opts={w.opts} onOptsChange={() => {}} /></WidgetDoorContext.Provider></div>)}
        </WorkspaceContext.Provider>
      </AuthContext.Provider>
    </MemoryRouter>
  )
}
const TWO = () => [CHART, wl('wa', 'user:w1', 'Momentum', 12), wl('wb', 'user:w2', 'Earnings', 18)]
function twoBoard() {
  const m = open(TWO(), { 'N:c1': 'NVDA' }, { extra: { watchlists: LISTS } })
  data.lists = () => m.board.state.server.lists.map(l => ({ ...l, description: '' }))
  m.h.listViews = buildListViewSource({ getWidgets: () => m.board.state.widgets })
  render(<DoorWidgets widgets={TWO().filter(w => w.type === 'watchlist')} start={{ A: 'NVDA', B: 'NVDA' }} />)
  return m
}
const boardJson = (m) => JSON.stringify(m.board.state.widgets)
const asked = (out) => /which/i.test(out) && !/is now|moved/i.test(out)

describe('F1 (b) u18-look-07: two Watchlists, "make the watchlist background black": asked, nothing written', () => {
  it('the plan picked the left one: a question, and neither widget\'s look changed', async () => {
    const m = twoBoard()
    await waitFor(() => expect(m.h.listViews.snapshot()).toHaveLength(2))
    const before = boardJson(m)
    const out = await m.say('make the watchlist background black', (c) => [op('widget.setOption', must(c.board?.[0]?.ref, 'board'), { widget: 'wa', key: 'canvasColor', value: '#000000' })])
    expect(asked(out), out).toBe(true)
    expect(boardJson(m)).toBe(before)
    expect(JSON.stringify(m.board.state.widgets)).not.toMatch(/#000000/)
  }, 60000)
})

describe('F1 (c) u18-cols-07: two Watchlists, "move the volume column after the symbol": asked, no column moved', () => {
  it('the plan picked Momentum\'s view: a question, and no saved column layout', async () => {
    const m = twoBoard()
    await waitFor(() => expect(m.h.listViews.snapshot()).toHaveLength(2))
    const out = await m.say('move the volume column after the symbol', (c) => [op('watchlist.arrangeColumns', viewOfList(c, 'Momentum'), { column: 'volume', before: null, after: 'symbol', width: null })])
    expect(asked(out), out).toBe(true)
    expect(cols()).toBe(null)
  }, 60000)
  it('control: "move the volume column after the symbol in Momentum" names it: moved, no question', async () => {
    const m = twoBoard()
    await waitFor(() => expect(m.h.listViews.snapshot()).toHaveLength(2))
    const out = await m.say('move the volume column after the symbol in Momentum', (c) => [op('watchlist.arrangeColumns', viewOfList(c, 'Momentum'), { column: 'volume', before: null, after: 'symbol', width: null })])
    expect(out).not.toMatch(/which/i)
    await waitFor(() => expect(cols()?.order?.indexOf('vol')).toBe((cols()?.order?.indexOf('sym') ?? -9) + 1))
  }, 60000)
})
